import functools
from abc import ABC, abstractmethod
from functools import cached_property
import inspect
import math

import numpy as np
from numpy import inf

from scipy._lib._array_api import xp_promote
from scipy._lib._util import _rng_spawn, _RichResult
from scipy._lib._docscrape import ClassDoc, NumpyDocString
from scipy import special, stats
from scipy.special._ufuncs import _log1mexp
from scipy.integrate import tanhsinh as _tanhsinh, nsum
from scipy.optimize._bracket import _bracket_root, _bracket_minimum
from scipy.optimize._chandrupatla import _chandrupatla, _chandrupatla_minimize
from scipy.stats._probability_distribution import _ProbabilityDistribution
from scipy.stats import qmc

# in case we need to distinguish between None and not specified
# Typically this is used to determine whether the tolerance has been set by the
# user and make a decision about which method to use to evaluate a distribution
# function. Sometimes, the logic does not consider the value of the tolerance,
# only whether this has been defined or not. This is not intended to be the
# best possible logic; the intent is to establish the structure, which can
# be refined in follow-up work.
# See https://github.com/scipy/scipy/pull/21050#discussion_r1714195433.
_null = object()
def _isnull(x):
    return type(x) is object or x is None

__all__ = ['make_distribution', 'Mixture', 'order_statistic',
           'truncate', 'abs', 'exp', 'log']

# Could add other policies for broadcasting and edge/out-of-bounds case handling
# For instance, when edge case handling is known not to be needed, it's much
# faster to turn it off, but it might still be nice to have array conversion
# and shaping done so the user doesn't need to be so careful.
_SKIP_ALL = "skip_all"
# Other cache policies would be useful, too.
_NO_CACHE = "no_cache"

# TODO:
#  Test sample dtypes
#  Add dtype kwarg (especially for distributions with no parameters)
#  When drawing endpoint/out-of-bounds values of a parameter, draw them from
#   the endpoints/out-of-bounds region of the full `domain`, not `typical`.
#  Distributions without shape parameters probably need to accept a `dtype` parameter;
#    right now they default to float64. If we have them default to float16, they will
#    need to determine result_type when input is not float16 (overhead).
#  Test _solve_bounded bracket logic, and decide what to do about warnings
#  Get test coverage to 100%
#  Raise when distribution method returns wrong shape/dtype?
#  Consider ensuring everything is at least 1D for calculations? Would avoid needing
#    to sprinkle `np.asarray` throughout due to indescriminate conversion of 0D arrays
#    to scalars
#  Break up `test_basic`: test each method separately
#  Fix `sample` for QMCEngine (implementation does not match documentation)
#  When a parameter is invalid, set only the offending parameter to NaN (if possible)?
#  `_tanhsinh` special case when there are no abscissae between the limits
#    example: cdf of uniform betweeen 1.0 and np.nextafter(1.0, np.inf)
#  check behavior of moment methods when moments are undefined/infinite -
#    basically OK but needs tests
#  investigate use of median
#  implement symmetric distribution
#  implement composite distribution
#  implement wrapped distribution
#  profile/optimize
#  general cleanup (choose keyword-only parameters)
#  compare old/new distribution timing
#  make video
#  add array API support
#  why does dist.ilogcdf(-100) not converge to bound? Check solver response to inf
#  _chandrupatla_minimize should not report xm = fm = NaN when it fails
#  integrate `logmoment` into `moment`? (Not hard, but enough time and code
#   complexity to wait for reviewer feedback before adding.)
#  Eliminate bracket_root error "`min <= a < b <= max` must be True"
#  Test repr?
#  use `median` information to improve integration? In some cases this will
#   speed things up. If it's not needed, it may be about twice as slow. I think
#   it should depend on the accuracy setting.
#  in tests, check reference value against that produced using np.vectorize?
#  add `axis` to `ks_1samp`
#  User tips for faster execution:
#  - pass NumPy arrays
#  - pass inputs of floating point type (not integers)
#  - prefer NumPy scalars or 0d arrays over other size 1 arrays
#  - pass no invalid parameters and disable invalid parameter checks with iv_profile
#  - provide a Generator if you're going to do sampling
#  add options for drawing parameters: log-spacing
#  accuracy benchmark suite
#  Should caches be attributes so we can more easily ensure that they are not
#   modified when caching is turned off?
#  Make ShiftedScaledDistribution more efficient - only process underlying
#   distribution parameters as necessary.
#  Reconsider `all_inclusive`
#  Should process_parameters update kwargs rather than returning? Should we
#   update parameters rather than setting to what process_parameters returns?

# Questions:
# 1.  I override `__getattr__` so that distribution parameters can be read as
#     attributes. We don't want uses to try to change them.
#     - To prevent replacements (dist.a = b), I could override `__setattr__`.
#     - To prevent in-place modifications, `__getattr__` could return a copy,
#       or it could set the WRITEABLE flag of the array to false.
#     Which should I do?
# 2.  `cache_policy` is supported in several methods where I imagine it being
#     useful, but it needs to be tested. Before doing that:
#     - What should the default value be?
#     - What should the other values be?
#     Or should we just eliminate this policy?
# 3.  `validation_policy` is supported in a few places, but it should be checked for
#     consistency. I have the same questions as for `cache_policy`.
# 4.  `tol` is currently notional. I think there needs to be way to set
#     separate `atol` and `rtol`. Some ways I imagine it being used:
#     - Values can be passed to iterative functions (quadrature, root-finder).
#     - To control which "method" of a distribution function is used. For
#       example, if `atol` is set to `1e-12`, it may be acceptable to compute
#       the complementary CDF as 1 - CDF even when CDF is nearly 1; otherwise,
#       a (potentially more time-consuming) method would need to be used.
#     I'm looking for unified suggestions for the interface, not ad hoc ideas
#     for using tolerances. Suppose the user wants to have more control over
#     the tolerances used for each method - how do they specify it? It would
#     probably be easiest for the user if they could pass tolerances into each
#     method, but it's easiest for us if they can only set it as a property of
#     the class. Perhaps a dictionary of tolerance settings?
# 5.  I also envision that accuracy estimates should be reported to the user
#     somehow. I think my preference would be to return a subclass of an array
#     with an `error` attribute - yes, really. But this is unlikely to be
#     popular, so what are other ideas? Again, we need a unified vision here,
#     not just pointing out difficulties (not all errors are known or easy
#     to estimate, what to do when errors could compound, etc.).
# 6.  The term "method" is used to refer to public instance functions,
#     private instance functions, the "method" string argument, and the means
#     of calculating the desired quantity (represented by the string argument).
#     For the sake of disambiguation, shall I rename the "method" string to
#     "strategy" and refer to the means of calculating the quantity as the
#     "strategy"?

# Originally, I planned to filter out invalid distribution parameters;
# distribution implementation functions would always work with "compressed",
# 1D arrays containing only valid distribution parameters. There are two
# problems with this:
# - This essentially requires copying all arrays, even if there is only a
#   single invalid parameter combination. This is expensive. Then, to output
#   the original size data to the user, we need to "decompress" the arrays
#   and fill in the NaNs, so more copying. Unless we branch the code when
#   there are no invalid data, these copies happen even in the normal case,
#   where there are no invalid parameter combinations. We should not incur
#   all this overhead in the normal case.
# - For methods that accept arguments other than distribution parameters, the
#   user will pass in arrays that are broadcastable with the original arrays,
#   not the compressed arrays. This means that this same sort of invalid
#   value detection needs to be repeated every time one of these methods is
#   called.
# The much simpler solution is to keep the data uncompressed but to replace
# the invalid parameters and arguments with NaNs (and only if some are
# invalid). With this approach, the copying happens only if/when it is
# needed. Most functions involved in stats distribution calculations don't
# mind NaNs; they just return NaN. The behavior "If x_i is NaN, the result
# is NaN" is explicit in the array API. So this should be fine.
#
# Currently, I am still leaving the parameters and function arguments
# in their broadcasted shapes rather than, say, raveling. The intent
# is to avoid back and forth reshaping. If authors of distributions have
# trouble dealing with N-D arrays, we can reconsider this.
#
# Another important decision is that the *private* methods must accept
# the distribution parameters as inputs rather than relying on these
# cached properties directly (although the public methods typically pass
# the cached values to the private methods). This is because the elementwise
# algorithms for quadrature, differentiation, root-finding, and minimization
# prefer that the input functions are strictly elementwise in the sense
# that the value output for a given input element does not depend on the
# shape of the input or that element's location within the input array.
# When the computation has converged for an element, it is removed from
# the computation entirely. As a result, the shape of the arrays passed to
# the function will almost never be broadcastable with the shape of the
# cached parameter arrays.
#
# I've sprinkled in some optimizations for scalars and same-shape/type arrays
# throughout. The biggest time sinks before were:
# - broadcast_arrays
# - result_dtype
# - is_subdtype
# It is much faster to check whether these are necessary than to do them.


class _Domain(ABC):
    r""" Representation of the applicable domain of a parameter or variable.

    A `_Domain` object is responsible for storing information about the
    domain of a parameter or variable, determining whether a value is within
    the domain (`contains`), and providing a text/mathematical representation
    of itself (`__str__`). Because the domain of a parameter/variable can have
    a complicated relationship with other parameters and variables of a
    distribution, `_Domain` itself does not try to represent all possibilities;
    in fact, it has no implementation and is meant for subclassing.

    Attributes
    ----------
    symbols : dict
        A map from special numerical values to symbols for use in `__str__`

    Methods
    -------
    contains(x)
        Determine whether the argument is contained within the domain (True)
        or not (False). Used for input validation.
    get_numerical_endpoints()
        Gets the numerical values of the domain endpoints, which may have been
        defined symbolically or through a callable.
    __str__()
        Returns a text representation of the domain (e.g. ``[0, b)``).
        Used for generating documentation.

    """
    symbols = {np.inf: r"\infty", -np.inf: r"-\infty", np.pi: r"\pi", -np.pi: r"-\pi"}

    @abstractmethod
    def contains(self, x):
        raise NotImplementedError()

    @abstractmethod
    def draw(self, n):
        raise NotImplementedError()

    @abstractmethod
    def get_numerical_endpoints(self, x):
        raise NotImplementedError()

    @abstractmethod
    def __str__(self):
        raise NotImplementedError()


class _Interval(_Domain):
    r""" Representation of an interval defined by two endpoints.

    Each endpoint may be a finite scalar, positive or negative infinity, or
    be given by a single parameter. The domain may include the endpoints or
    not.

    This class still does not provide an implementation of the __str__ method,
    so it is meant for subclassing (e.g. a subclass for domains on the real
    line).

    Attributes
    ----------
    symbols : dict
        Inherited. A map from special values to symbols for use in `__str__`.
    endpoints : 2-tuple of float(s) and/or str(s) and/or callable(s).
        A tuple with two values. Each may be either a float (the numerical
        value of the endpoints of the domain), a string (the name of the
        parameters that will define the endpoint), or a callable taking the
        parameters used to define the endpoints of the domain as keyword only
        arguments and returning a numerical value for the endpoint.
    inclusive : 2-tuple of bools
        A tuple with two boolean values; each indicates whether the
        corresponding endpoint is included within the domain or not.

    Methods
    -------
    define_parameters(*parameters)
        Records any parameters used to define the endpoints of the domain
    get_numerical_endpoints(parameter_values)
        Gets the numerical values of the domain endpoints, which may have been
        defined symbolically or through a callable.
    contains(item, parameter_values)
        Determines whether the argument is contained within the domain
    draw(size, rng, proportions, parameter_values)
        Draws random values based on the domain.

    """
    def __init__(self, endpoints=(-inf, inf), inclusive=(False, False)):
        self.symbols = super().symbols.copy()
        a, b = endpoints
        self.endpoints = np.asarray(a)[()], np.asarray(b)[()]
        self.inclusive = inclusive

    def define_parameters(self, *parameters):
        r""" Records any parameters used to define the endpoints of the domain.

        Adds the keyword name of each parameter and its text representation
        to the  `symbols` attribute as key:value pairs.
        For instance, a parameter may be passed into to a distribution's
        initializer using the keyword `log_a`, and the corresponding
        string representation may be '\log(a)'. To form the text
        representation of the domain for use in documentation, the
        _Domain object needs to map from the keyword name used in the code
        to the string representation.

        Returns None, but updates the `symbols` attribute.

        Parameters
        ----------
        *parameters : _Parameter objects
            Parameters that may define the endpoints of the domain.

        """
        new_symbols = {param.name: param.symbol for param in parameters}
        self.symbols.update(new_symbols)

    def get_numerical_endpoints(self, parameter_values):
        r""" Get the numerical values of the domain endpoints.

        Domain endpoints may be defined symbolically or through a callable.
        This returns numerical values of the endpoints given numerical values for
        any variables.

        Parameters
        ----------
        parameter_values : dict
            A dictionary that maps between string variable names and numerical
            values of parameters, which may define the endpoints.

        Returns
        -------
        a, b : ndarray
            Numerical values of the endpoints

        """
        a, b = self.endpoints
        # If `a` (`b`) is a string - the name of the parameter that defines
        # the endpoint of the domain - then corresponding numerical values
        # will be found in the `parameter_values` dictionary.
        # If a callable, it will be executed with `parameter_values` passed as
        # keyword arguments, and it will return the numerical values.
        # Otherwise, it is itself the array of numerical values of the endpoint.
        try:
            if callable(a):
                a = a(**parameter_values)
            else:
                a = np.asarray(parameter_values.get(a, a))
            if callable(b):
                b = b(**parameter_values)
            else:
                b = np.asarray(parameter_values.get(b, b))
        except TypeError as e:
            message = ("The endpoints of the distribution are defined by "
                       "parameters, but their values were not provided. When "
                       f"using a private method of {self.__class__}, pass "
                       "all required distribution parameters as keyword "
                       "arguments.")
            raise TypeError(message) from e
        # Floating point types are used for even integer parameters.
        # Convert to float here to ensure consistency throughout framework.
        a, b = xp_promote(a, b, force_floating=True, xp=np)
        return a, b

    def contains(self, item, parameter_values=None):
        r"""Determine whether the argument is contained within the domain.

        Parameters
        ----------
        item : ndarray
            The argument
        parameter_values : dict
            A dictionary that maps between string variable names and numerical
            values of parameters, which may define the endpoints.

        Returns
        -------
        out : bool
            True if `item` is within the domain; False otherwise.

        """
        parameter_values = parameter_values or {}
        # if self.all_inclusive:
        #     # Returning a 0d value here makes things much faster.
        #     # I'm not sure if it's safe, though. If it causes a bug someday,
        #     # I guess it wasn't.
        #     # Even if there is no bug because of the shape, it is incorrect for
        #     # `contains` to return True when there are invalid (e.g. NaN)
        #     # parameters.
        #     return np.asarray(True)

        a, b = self.get_numerical_endpoints(parameter_values)
        left_inclusive, right_inclusive = self.inclusive

        in_left = item >= a if left_inclusive else item > a
        in_right = item <= b if right_inclusive else item < b
        return in_left & in_right

    def draw(self, n, type_, min, max, squeezed_base_shape, rng=None):
        r""" Draw random values from the domain.

        Parameters
        ----------
        n : int
            The number of values to be drawn from the domain.
        type_ : str
            A string indicating whether the values are

            - strictly within the domain ('in'),
            - at one of the two endpoints ('on'),
            - strictly outside the domain ('out'), or
            - NaN ('nan').
        min, max : ndarray
            The endpoints of the domain.
        squeezed_based_shape : tuple of ints
            See _RealParameter.draw.
        rng : np.Generator
            The Generator used for drawing random values.

        """
        rng = np.random.default_rng(rng)

        def ints(*args, **kwargs): return rng.integers(*args, **kwargs, endpoint=True)
        uniform = rng.uniform if isinstance(self, _RealInterval) else ints

        # get copies of min and max with no nans so that uniform doesn't fail
        min_nn, max_nn = min.copy(), max.copy()
        i = np.isnan(min_nn) | np.isnan(max_nn)
        min_nn[i] = 0
        max_nn[i] = 1

        shape = (n,) + squeezed_base_shape

        if type_ == 'in':
            z = uniform(min_nn, max_nn, size=shape)

        elif type_ == 'on':
            z_on_shape = shape
            z = np.ones(z_on_shape)
            i = rng.random(size=n) < 0.5
            z[i] = min
            z[~i] = max

        elif type_ == 'out':
            z = min_nn - uniform(1, 5, size=shape)   # 1, 5 is arbitary; we just want
            zr = max_nn + uniform(1, 5, size=shape)  # some numbers outside domain
            i = rng.random(size=n) < 0.5
            z[i] = zr[i]

        elif type_ == 'nan':
            z = np.full(shape, np.nan)

        return z


class _RealInterval(_Interval):
    r""" Represents a simply-connected subset of the real line; i.e., an interval

    Completes the implementation of the `_Interval` class for intervals
    on the real line.

    Methods
    -------
    define_parameters(*parameters)
        (Inherited) Records any parameters used to define the endpoints of the
        domain.
    get_numerical_endpoints(parameter_values)
        (Inherited) Gets the numerical values of the domain endpoints, which
        may have been defined symbolically.
    contains(item, parameter_values)
        (Inherited) Determines whether the argument is contained within the
        domain
    __str__()
        Returns a string representation of the domain, e.g. "[a, b)".
    """

    def __str__(self):
        a, b = self.endpoints
        a, b = self._get_endpoint_str(a, "f1"), self._get_endpoint_str(b, "f2")
        left_inclusive, right_inclusive = self.inclusive
        left = "[" if left_inclusive else "("
        right = "]" if right_inclusive else ")"

        return f"{left}{a}, {b}{right}"

    def _get_endpoint_str(self, endpoint, funcname):
        if callable(endpoint):
            if endpoint.__doc__ is not None:
                return endpoint.__doc__
            params = inspect.signature(endpoint).parameters.values()
            params = [
                p.name for p in params if p.kind == inspect.Parameter.KEYWORD_ONLY
            ]
            return f"{funcname}({','.join(params)})"
        return self.symbols.get(endpoint, f"{endpoint}")


class _IntegerInterval(_Interval):
    r""" Represents an interval of integers

    Completes the implementation of the `_Interval` class for simple
    domains on the integers.

    Methods
    -------
    define_parameters(*parameters)
        (Inherited) Records any parameters used to define the endpoints of the
        domain.
    get_numerical_endpoints(parameter_values)
        (Inherited) Gets the numerical values of the domain endpoints, which
        may have been defined symbolically.
    contains(item, parameter_values)
        (Overridden) Determines whether the argument is contained within the
        domain
    draw(n, type_, min, max, squeezed_base_shape, rng=None)
        (Inherited) Draws random values based on the domain.
    __str__()
        Returns a string representation of the domain, e.g. "{a, a+1, ..., b-1, b}".

    """
    def contains(self, item, parameter_values=None):
        super_contains = super().contains(item, parameter_values)
        integral = (item == np.round(item))
        return super_contains & integral

    def __str__(self):
        a, b = self.endpoints
        a = self.symbols.get(a, a)
        b = self.symbols.get(b, b)

        a_str, b_str = isinstance(a, str), isinstance(b, str)
        a_inf = a == r"-\infty" if a_str else np.isinf(a)
        b_inf = b == r"\infty" if b_str else np.isinf(b)

        # This doesn't work well for cases where ``a`` is floating point
        # number large enough that ``nextafter(a, inf) > a + 1``, and
        # similarly for ``b`` and nextafter(b, -inf). There may not be any
        # distributions fit for SciPy where we would actually need to handle these
        # cases though.
        ap1 = f"{a} + 1" if a_str else f"{a + 1}"
        bm1 = f"{b} - 1" if b_str else f"{b - 1}"

        if not a_str and not b_str:
            gap = b - a
            if gap == 3:
                return f"\\{{{a}, {ap1}, {bm1}, {b}\\}}"
            if gap == 2:
                return f"\\{{{a}, {ap1}, {b}\\}}"
            if gap == 1:
                return f"\\{{{a}, {b}\\}}"
            if gap == 0:
                return f"\\{{{a}\\}}"

        if not a_inf and b_inf:
            ap2 = f"{a} + 2" if a_str else f"{a + 2}"
            return f"\\{{{a}, {ap1}, {ap2}, ...\\}}"
        if a_inf and not b_inf:
            bm2 = f"{b} - 2" if b_str else f"{b - 2}"
            return f"\\{{{b}, {bm1}, {bm2}, ...\\}}"
        if a_inf and b_inf:
            return "\\{..., -2, -1, 0, 1, 2, ...\\}"

        return f"\\{{{a}, {ap1}, ..., {bm1}, {b}\\}}"


class _Parameter(ABC):
    r""" Representation of a distribution parameter or variable.

    A `_Parameter` object is responsible for storing information about a
    parameter or variable, providing input validation/standardization of
    values passed for that parameter, providing a text/mathematical
    representation of the parameter for the documentation (`__str__`), and
    drawing random values of itself for testing and benchmarking. It does
    not provide a complete implementation of this functionality and is meant
    for subclassing.

    Attributes
    ----------
    name : str
        The keyword used to pass numerical values of the parameter into the
        initializer of the distribution
    symbol : str
        The text representation of the variable in the documentation. May
        include LaTeX.
    domain : _Domain
        The domain of the parameter for which the distribution is valid.
    typical : 2-tuple of floats or strings (consider making a _Domain)
        Defines the endpoints of a typical range of values of the parameter.
        Used for sampling.

    Methods
    -------
    __str__():
        Returns a string description of the variable for use in documentation,
        including the keyword used to represent it in code, the symbol used to
        represent it mathemtatically, and a description of the valid domain.
    draw(size, *, rng, domain, proportions)
        Draws random values of the parameter. Proportions of values within
        the valid domain, on the endpoints of the domain, outside the domain,
        and having value NaN are specified by `proportions`.
    validate(x):
        Validates and standardizes the argument for use as numerical values
        of the parameter.

   """
    def __init__(self, name, *, domain, symbol=None, typical=None):
        self.name = name
        self.symbol = symbol or name
        self.domain = domain
        if typical is not None and not isinstance(typical, _Domain):
            typical = domain.__class__(typical)
        self.typical = typical or domain

    def __str__(self):
        r""" String representation of the parameter for use in documentation."""
        return f"`{self.name}` for :math:`{self.symbol} \\in {str(self.domain)}`"

    def draw(self, size=None, *, rng=None, region='domain', proportions=None,
             parameter_values=None):
        r""" Draw random values of the parameter for use in testing.

        Parameters
        ----------
        size : tuple of ints
            The shape of the array of valid values to be drawn.
        rng : np.Generator
            The Generator used for drawing random values.
        region : str
            The region of the `_Parameter` from which to draw. Default is
            "domain" (the *full* domain); alternative is "typical". An
            enhancement would give a way to interpolate between the two.
        proportions : tuple of numbers
            A tuple of four non-negative numbers that indicate the expected
            relative proportion of elements that:

            - are strictly within the domain,
            - are at one of the two endpoints,
            - are strictly outside the domain, and
            - are NaN,

            respectively. Default is (1, 0, 0, 0). The number of elements in
            each category is drawn from the multinomial distribution with
            `np.prod(size)` as the number of trials and `proportions` as the
            event probabilities. The values in `proportions` are automatically
            normalized to sum to 1.
        parameter_values : dict
            Map between the names of parameters (that define the endpoints of
            `typical`) and numerical values (arrays).

        """
        parameter_values = parameter_values or {}
        domain = self.domain
        proportions = (1, 0, 0, 0) if proportions is None else proportions

        pvals = proportions / np.sum(proportions)

        a, b = domain.get_numerical_endpoints(parameter_values)
        a, b = np.broadcast_arrays(a, b)

        base_shape = a.shape
        extended_shape = np.broadcast_shapes(size, base_shape)
        n_extended = np.prod(extended_shape)
        n_base = np.prod(base_shape)
        n = int(n_extended / n_base) if n_extended else 0

        rng = np.random.default_rng(rng)
        n_in, n_on, n_out, n_nan = rng.multinomial(n, pvals)

        # `min` and `max` can have singleton dimensions that correspond with
        # non-singleton dimensions in `size`. We need to be careful to avoid
        # shuffling results (e.g. a value that was generated for the domain
        # [min[i], max[i]] ends up at index j). To avoid this:
        # - Squeeze the singleton dimensions out of `min`/`max`. Squeezing is
        #   often not the right thing to do, but here is equivalent to moving
        #   all the dimensions that are singleton in `min`/`max` (which may be
        #   non-singleton in the result) to the left. This is what we want.
        # - Now all the non-singleton dimensions of the result are on the left.
        #   Ravel them to a single dimension of length `n`, which is now along
        #   the 0th axis.
        # - Reshape the 0th axis back to the required dimensions, and move
        #   these axes back to their original places.
        base_shape_padded = ((1,)*(len(extended_shape) - len(base_shape))
                             + base_shape)
        base_singletons = np.where(np.asarray(base_shape_padded)==1)[0]
        new_base_singletons = tuple(range(len(base_singletons)))
        # Base singleton dimensions are going to get expanded to these lengths
        shape_expansion = np.asarray(extended_shape)[base_singletons]

        # assert(np.prod(shape_expansion) == n)  # check understanding
        # min = np.reshape(min, base_shape_padded)
        # max = np.reshape(max, base_shape_padded)
        # min = np.moveaxis(min, base_singletons, new_base_singletons)
        # max = np.moveaxis(max, base_singletons, new_base_singletons)
        # squeezed_base_shape = max.shape[len(base_singletons):]
        # assert np.all(min.reshape(squeezed_base_shape) == min.squeeze())
        # assert np.all(max.reshape(squeezed_base_shape) == max.squeeze())

        # min = np.maximum(a, _fiinfo(a).min/10) if np.any(np.isinf(a)) else a
        # max = np.minimum(b, _fiinfo(b).max/10) if np.any(np.isinf(b)) else b
        min = np.asarray(a.squeeze())
        max = np.asarray(b.squeeze())
        squeezed_base_shape = max.shape

        if region == 'typical':
            typical = self.typical
            a, b = typical.get_numerical_endpoints(parameter_values)
            a, b = np.broadcast_arrays(a, b)
            min_here = np.asarray(a.squeeze())
            max_here = np.asarray(b.squeeze())
            z_in = typical.draw(n_in, 'in', min_here, max_here, squeezed_base_shape,
                                rng=rng)
        else:
            z_in = domain.draw(n_in, 'in', min, max, squeezed_base_shape, rng=rng)
        z_on = domain.draw(n_on, 'on', min, max, squeezed_base_shape, rng=rng)
        z_out = domain.draw(n_out, 'out', min, max, squeezed_base_shape, rng=rng)
        z_nan= domain.draw(n_nan, 'nan', min, max, squeezed_base_shape, rng=rng)

        z = np.concatenate((z_in, z_on, z_out, z_nan), axis=0)
        z = rng.permuted(z, axis=0)

        z = np.reshape(z, tuple(shape_expansion) + squeezed_base_shape)
        z = np.moveaxis(z, new_base_singletons, base_singletons)
        return z

    @abstractmethod
    def validate(self, arr):
        raise NotImplementedError()


class _RealParameter(_Parameter):
    r""" Represents a real-valued parameter.

    Implements the remaining methods of _Parameter for real parameters.
    All attributes are inherited.

    """
    def validate(self, arr, parameter_values):
        r""" Input validation/standardization of numerical values of a parameter.

        Checks whether elements of the argument `arr` are reals, ensuring that
        the dtype reflects this. Also produces a logical array that indicates
        which elements meet the requirements.

        Parameters
        ----------
        arr : ndarray
            The argument array to be validated and standardized.
        parameter_values : dict
            Map of parameter names to parameter value arrays.

        Returns
        -------
        arr : ndarray
            The argument array that has been validated and standardized
            (converted to an appropriate dtype, if necessary).
        dtype : NumPy dtype
            The appropriate floating point dtype of the parameter.
        valid : boolean ndarray
            Logical array indicating which elements are valid (True) and
            which are not (False). The arrays of all distribution parameters
            will be broadcasted, and elements for which any parameter value
            does not meet the requirements will be replaced with NaN.

        """
        arr = np.asarray(arr)

        valid_dtype = None
        # minor optimization - fast track the most common types to avoid
        # overhead of np.issubdtype. Checking for `in {...}` doesn't work : /
        if arr.dtype == np.float64 or arr.dtype == np.float32:
            pass
        elif arr.dtype == np.int32 or arr.dtype == np.int64:
            arr = np.asarray(arr, dtype=np.float64)
        elif np.issubdtype(arr.dtype, np.floating):
            pass
        elif np.issubdtype(arr.dtype, np.integer):
            arr = np.asarray(arr, dtype=np.float64)
        else:
            message = f"Parameter `{self.name}` must be of real dtype."
            raise TypeError(message)

        valid = self.domain.contains(arr, parameter_values)
        valid = valid & valid_dtype if valid_dtype is not None else valid

        return arr[()], arr.dtype, valid


class _Parameterization:
    r""" Represents a parameterization of a distribution.

    Distributions can have multiple parameterizations. A `_Parameterization`
    object is responsible for recording the parameters used by the
    parameterization, checking whether keyword arguments passed to the
    distribution match the parameterization, and performing input validation
    of the numerical values of these parameters.

    Attributes
    ----------
    parameters : dict
        String names (of keyword arguments) and the corresponding _Parameters.

    Methods
    -------
    __len__()
        Returns the number of parameters in the parameterization.
    __str__()
        Returns a string representation of the parameterization.
    copy
        Returns a copy of the parameterization. This is needed for transformed
        distributions that add parameters to the parameterization.
    matches(parameters)
        Checks whether the keyword arguments match the parameterization.
    validation(parameter_values)
        Input validation / standardization of parameterization. Validates the
        numerical values of all parameters.
    draw(sizes, rng, proportions)
        Draw random values of all parameters of the parameterization for use
        in testing.
    """
    def __init__(self, *parameters):
        self.parameters = {param.name: param for param in parameters}

    def __len__(self):
        return len(self.parameters)

    def copy(self):
        return _Parameterization(*self.parameters.values())

    def matches(self, parameters):
        r""" Checks whether the keyword arguments match the parameterization.

        Parameters
        ----------
        parameters : set
            Set of names of parameters passed into the distribution as keyword
            arguments.

        Returns
        -------
        out : bool
            True if the keyword arguments names match the names of the
            parameters of this parameterization.
        """
        return parameters == set(self.parameters.keys())

    def validation(self, parameter_values):
        r""" Input validation / standardization of parameterization.

        Parameters
        ----------
        parameter_values : dict
            The keyword arguments passed as parameter values to the
            distribution.

        Returns
        -------
        all_valid : ndarray
            Logical array indicating the elements of the broadcasted arrays
            for which all parameter values are valid.
        dtype : dtype
            The common dtype of the parameter arrays. This will determine
            the dtype of the output of distribution methods.
        """
        all_valid = True
        dtypes = set()  # avoid np.result_type if there's only one type
        for name, arr in parameter_values.items():
            parameter = self.parameters[name]
            arr, dtype, valid = parameter.validate(arr, parameter_values)
            dtypes.add(dtype)
            all_valid = all_valid & valid
            parameter_values[name] = arr
        dtype = arr.dtype if len(dtypes)==1 else np.result_type(*list(dtypes))

        return all_valid, dtype

    def __str__(self):
        r"""Returns a string representation of the parameterization."""
        messages = [str(param) for name, param in self.parameters.items()]
        return ", ".join(messages)

    def draw(self, sizes=None, rng=None, proportions=None, region='domain'):
        r"""Draw random values of all parameters for use in testing.

        Parameters
        ----------
        sizes : iterable of shape tuples
            The size of the array to be generated for each parameter in the
            parameterization. Note that the order of sizes is arbitary; the
            size of the array generated for a specific parameter is not
            controlled individually as written.
        rng : NumPy Generator
            The generator used to draw random values.
        proportions : tuple
            A tuple of four non-negative numbers that indicate the expected
            relative proportion of elements that are within the parameter's
            domain, are on the boundary of the parameter's domain, are outside
            the parameter's domain, and have value NaN. For more information,
            see the `draw` method of the _Parameter subclasses.
        domain : str
            The domain of the `_Parameter` from which to draw. Default is
            "domain" (the *full* domain); alternative is "typical".

        Returns
        -------
        parameter_values : dict (string: array)
            A dictionary of parameter name/value pairs.
        """
        # ENH: be smart about the order. The domains of some parameters
        # depend on others. If the relationshp is simple (e.g. a < b < c),
        # we can draw values in order a, b, c.
        parameter_values = {}

        if sizes is None or not len(sizes) or not np.iterable(sizes[0]):
            sizes = [sizes]*len(self.parameters)

        for size, param in zip(sizes, self.parameters.values()):
            parameter_values[param.name] = param.draw(
                size, rng=rng, proportions=proportions,
                parameter_values=parameter_values,
                region=region
            )

        return parameter_values


def _set_invalid_nan(f):
    # Wrapper for input / output validation and standardization of distribution
    # functions that accept either the quantile or percentile as an argument:
    # logpdf, pdf
    # logpmf, pmf
    # logcdf, cdf
    # logccdf, ccdf
    # ilogcdf, icdf
    # ilogccdf, iccdf
    # Arguments that are outside the required range are replaced by NaN before
    # passing them into the underlying function. The corresponding outputs
    # are replaced by the appropriate value before being returned to the user.
    # For example, when the argument of `cdf` exceeds the right end of the
    # distribution's support, the wrapper replaces the argument with NaN,
    # ignores the output of the underlying function, and returns 1.0. It also
    # ensures that output is of the appropriate shape and dtype.

    endpoints = {'icdf': (0, 1), 'iccdf': (0, 1),
                 'ilogcdf': (-np.inf, 0), 'ilogccdf': (-np.inf, 0)}
    replacements = {'logpdf': (-inf, -inf), 'pdf': (0, 0),
                    'logpmf': (-inf, -inf), 'pmf': (0, 0),
                    '_logcdf1': (-inf, 0), '_logccdf1': (0, -inf),
                    '_cdf1': (0, 1), '_ccdf1': (1, 0)}
    replace_strict = {'pdf', 'logpdf', 'pmf', 'logpmf'}
    replace_exact = {'icdf', 'iccdf', 'ilogcdf', 'ilogccdf'}
    clip = {'_cdf1', '_ccdf1'}
    clip_log = {'_logcdf1', '_logccdf1'}
    # relevant to discrete distributions only
    replace_non_integral = {'pmf', 'logpmf', 'pdf', 'logpdf'}

    @functools.wraps(f)
    def filtered(self, x, *args, **kwargs):
        if self.validation_policy == _SKIP_ALL:
            return f(self, x, *args, **kwargs)

        method_name = f.__name__
        x = np.asarray(x)
        dtype = self._dtype
        shape = self._shape
        discrete = isinstance(self, DiscreteDistribution)
        keep_low_endpoint = discrete and method_name in {'_cdf1', '_logcdf1',
                                                         '_ccdf1', '_logccdf1'}

        # Ensure that argument is at least as precise as distribution
        # parameters, which are already at least floats. This will avoid issues
        # with raising integers to negative integer powers and failure to replace
        # invalid integers with NaNs.
        if x.dtype != dtype:
            dtype = np.result_type(x.dtype, dtype)
            x = np.asarray(x, dtype=dtype)

        # Broadcasting is slow. Do it only if necessary.
        if not x.shape == shape:
            try:
                shape = np.broadcast_shapes(x.shape, shape)
                x = np.broadcast_to(x, shape)
                # Should we broadcast the distribution parameters to this shape, too?
            except ValueError as e:
                message = (
                    f"The argument provided to `{self.__class__.__name__}"
                    f".{method_name}` cannot be be broadcast to the same "
                    "shape as the distribution parameters.")
                raise ValueError(message) from e

        low, high = endpoints.get(method_name, self.support())

        # Check for arguments outside of domain. They'll be replaced with NaNs,
        # and the result will be set to the appropriate value.
        left_inc, right_inc = self._variable.domain.inclusive
        mask_low = (x < low if (method_name in replace_strict and left_inc)
                    or keep_low_endpoint else x <= low)
        mask_high = (x > high if (method_name in replace_strict and right_inc)
                     else x >= high)
        mask_invalid = (mask_low | mask_high)
        any_invalid = (mask_invalid if mask_invalid.shape == ()
                       else np.any(mask_invalid))

        # Check for arguments at domain endpoints, whether they
        # are part of the domain or not.
        any_endpoint = False
        if method_name in replace_exact:
            mask_low_endpoint = (x == low)
            mask_high_endpoint = (x == high)
            mask_endpoint = (mask_low_endpoint | mask_high_endpoint)
            any_endpoint = (mask_endpoint if mask_endpoint.shape == ()
                            else np.any(mask_endpoint))

        # Check for non-integral arguments to PMF method
        # or PDF of a discrete distribution.
        any_non_integral = False
        if discrete and method_name in replace_non_integral:
            mask_non_integral = (x != np.floor(x))
            any_non_integral = (mask_non_integral if mask_non_integral.shape == ()
                                else np.any(mask_non_integral))

        # Set out-of-domain arguments to NaN. The result will be set to the
        # appropriate value later.
        if any_invalid:
            x = np.array(x, dtype=dtype, copy=True)
            x[mask_invalid] = np.nan

        res = np.asarray(f(self, x, *args, **kwargs))

        # Ensure that the result is the correct dtype and shape,
        # copying (only once) if necessary.
        res_needs_copy = False
        if res.dtype != dtype:
            dtype = np.result_type(dtype, self._dtype)
            res_needs_copy = True

        if res.shape != shape:  # faster to check first
            res = np.broadcast_to(res, self._shape)
            res_needs_copy = (res_needs_copy or any_invalid
                              or any_endpoint or any_non_integral)

        if res_needs_copy:
            res = np.array(res, dtype=dtype, copy=True)

        # For non-integral arguments to PMF (and PDF of discrete distribution)
        # replace with zero.
        if any_non_integral:
            zero = -np.inf if method_name in {'logpmf', 'logpdf'} else 0
            res[mask_non_integral & ~np.isnan(res)] = zero

        # For arguments outside the function domain, replace results
        if any_invalid:
            replace_low, replace_high = (
                replacements.get(method_name, (np.nan, np.nan)))
            res[mask_low] = replace_low
            res[mask_high] = replace_high

        # For arguments at the endpoints of the domain, replace results
        if any_endpoint:
            a, b = self.support()
            if a.shape != shape:
                a = np.array(np.broadcast_to(a, shape), copy=True)
                b = np.array(np.broadcast_to(b, shape), copy=True)

            replace_low_endpoint = (
                b[mask_low_endpoint] if method_name.endswith('ccdf')
                else a[mask_low_endpoint])
            replace_high_endpoint = (
                a[mask_high_endpoint] if method_name.endswith('ccdf')
                else b[mask_high_endpoint])

            if not keep_low_endpoint:
                res[mask_low_endpoint] = replace_low_endpoint
            res[mask_high_endpoint] = replace_high_endpoint

        # Clip probabilities to [0, 1]
        if method_name in clip:
            res = np.clip(res, 0., 1.)
        elif method_name in clip_log:
            res = res.real  # exp(res) > 0
            res = np.clip(res, None, 0.)  # exp(res) < 1

        return res[()]

    return filtered


def _set_invalid_nan_property(f):
    # Wrapper for input / output validation and standardization of distribution
    # functions that represent properties of the distribution itself:
    # logentropy, entropy
    # median, mode
    # moment
    # It ensures that the output is of the correct shape and dtype and that
    # there are NaNs wherever the distribution parameters were invalid.

    @functools.wraps(f)
    def filtered(self, *args, **kwargs):
        if self.validation_policy == _SKIP_ALL:
            return f(self, *args, **kwargs)

        res = f(self, *args, **kwargs)
        if res is None:
            # message could be more appropriate
            raise NotImplementedError(self._not_implemented)

        res = np.asarray(res)
        needs_copy = False
        dtype = res.dtype

        if dtype != self._dtype:  # this won't work for logmoments (complex)
            dtype = np.result_type(dtype, self._dtype)
            needs_copy = True

        if res.shape != self._shape:  # faster to check first
            res = np.broadcast_to(res, self._shape)
            needs_copy = needs_copy or self._any_invalid

        if needs_copy:
            res = res.astype(dtype=dtype, copy=True)

        if self._any_invalid:
            # may be redundant when quadrature is used, but not necessarily
            # when formulas are used.
            res[self._invalid] = np.nan

        return res[()]

    return filtered


def _dispatch(f):
    # For each public method (instance function) of a distribution (e.g. ccdf),
    # there may be several ways ("method"s) that it can be computed (e.g. a
    # formula, as the complement of the CDF, or via numerical integration).
    # Each "method" is implemented by a different private method (instance
    # function).
    # This wrapper calls the appropriate private method based on the public
    # method and any specified `method` keyword option.
    # - If `method` is specified as a string (by the user), the appropriate
    #   private method is called.
    # - If `method` is None:
    #   - The appropriate private method for the public method is looked up
    #     in a cache.
    #   - If the cache does not have an entry for the public method, the
    #     appropriate "dispatch " function is called to determine which method
    #     is most appropriate given the available private methods and
    #     settings (e.g. tolerance).

    @functools.wraps(f)
    def wrapped(self, *args, method=None, **kwargs):
        func_name = f.__name__
        method = method or self._method_cache.get(func_name, None)
        if callable(method):
            pass
        elif method is not None:
            method = 'logexp' if method == 'log/exp' else method
            method_name = func_name.replace('dispatch', method)
            method = getattr(self, method_name)
        else:
            method = f(self, *args, method=method, **kwargs)
            if func_name != '_sample_dispatch' and self.cache_policy != _NO_CACHE:
                self._method_cache[func_name] = method

        try:
            return method(*args, **kwargs)
        except KeyError as e:
            raise NotImplementedError(self._not_implemented) from e

    return wrapped


def _cdf2_input_validation(f):
    # Wrapper that does the job of `_set_invalid_nan` when `cdf` or `logcdf`
    # is called with two quantile arguments.
    # Let's keep it simple; no special cases for speed right now.
    # The strategy is a bit different than for 1-arg `cdf` (and other methods
    # covered by `_set_invalid_nan`). For 1-arg `cdf`, elements of `x` that
    # are outside (or at the edge of) the support get replaced by `nan`,
    # and then the results get replaced by the appropriate value (0 or 1).
    # We *could* do something similar, dispatching to `_cdf1` in these
    # cases. That would be a bit more robust, but it would also be quite
    # a bit more complex, since we'd have to do different things when
    # `x` and `y` are both out of bounds, when just `x` is out of bounds,
    # when just `y` is out of bounds, and when both are out of bounds.
    # I'm not going to do that right now. Instead, simply replace values
    # outside the support by those at the edge of the support. Here, we also
    # omit some of the optimizations that make `_set_invalid_nan` faster for
    # simple arguments (e.g. float64 scalars).

    @functools.wraps(f)
    def wrapped(self, x, y, *args, **kwargs):
        func_name = f.__name__

        low, high = self.support()
        x, y, low, high = np.broadcast_arrays(x, y, low, high)
        dtype = np.result_type(x.dtype, y.dtype, self._dtype)
        # yes, copy to avoid modifying input arrays
        x, y = x.astype(dtype, copy=True), y.astype(dtype, copy=True)

        # Swap arguments to ensure that x < y, and replace
        # out-of domain arguments with domain endpoints. We'll
        # transform the result later.
        i_swap = y < x
        x[i_swap], y[i_swap] = y[i_swap], x[i_swap]
        i = x < low
        x[i] = low[i]
        i = y < low
        y[i] = low[i]
        i = x > high
        x[i] = high[i]
        i = y > high
        y[i] = high[i]

        res = f(self, x, y, *args, **kwargs)

        # Clipping probability to [0, 1]
        if func_name in {'_cdf2', '_ccdf2'}:
            res = np.clip(res, 0., 1.)
        else:
            res = np.clip(res, None, 0.)  # exp(res) < 1

        # Transform the result to account for swapped argument order
        res = np.asarray(res)
        if func_name == '_cdf2':
            res[i_swap] *= -1.
        elif func_name == '_ccdf2':
            res[i_swap] *= -1
            res[i_swap] += 2.
        elif func_name == '_logcdf2':
            res = np.asarray(res + 0j) if np.any(i_swap) else res
            res[i_swap] = res[i_swap] + np.pi*1j
        else:
            # res[i_swap] is always positive and less than 1, so it's
            # safe to ensure that the result is real
            res[i_swap] = _logexpxmexpy(np.log(2), res[i_swap]).real
        return res[()]

    return wrapped


def _fiinfo(x):
    if np.issubdtype(x.dtype, np.inexact):
        return np.finfo(x.dtype)
    else:
        return np.iinfo(x)


def _kwargs2args(f, args=None, kwargs=None):
    # Wraps a function that accepts a primary argument `x`, secondary
    # arguments `args`, and secondary keyward arguments `kwargs` such that the
    # wrapper accepts only `x` and `args`. The keyword arguments are extracted
    # from `args` passed into the wrapper, and these are passed to the
    # underlying function as `kwargs`.
    # This is a temporary workaround until the scalar algorithms `_tanhsinh`,
    # `_chandrupatla`, etc., support `kwargs` or can operate with compressing
    # arguments to the callable.
    args = args or []
    kwargs = kwargs or {}
    names = list(kwargs.keys())
    n_args = len(args)

    def wrapped(x, *args):
        return f(x, *args[:n_args], **dict(zip(names, args[n_args:])))

    args = tuple(args) + tuple(kwargs.values())

    return wrapped, args


def _logexpxmexpy(x, y):
    """ Compute the log of the difference of the exponentials of two arguments.

    Avoids over/underflow, but does not prevent loss of precision otherwise.
    """
    # TODO: properly avoid NaN when y is negative infinity
    # TODO: silence warning with taking log of complex nan
    # TODO: deal with x == y better
    i = np.isneginf(np.real(y))
    if np.any(i):
        y = np.asarray(y.copy())
        y[i] = np.finfo(y.dtype).min
    x, y = np.broadcast_arrays(x, y)
    res = np.asarray(special.logsumexp([x, y+np.pi*1j], axis=0))
    i = (x == y)
    res[i] = -np.inf
    return res


def _guess_bracket(xmin, xmax):
    a = np.full_like(xmin, -1.0)
    b = np.ones_like(xmax)

    i = np.isfinite(xmin) & np.isfinite(xmax)
    a[i] = xmin[i]
    b[i] = xmax[i]

    i = np.isfinite(xmin) & ~np.isfinite(xmax)
    a[i] = xmin[i]
    b[i] = xmin[i] + 1

    i = np.isfinite(xmax) & ~np.isfinite(xmin)
    a[i] = xmax[i] - 1
    b[i] = xmax[i]

    return a, b


def _log_real_standardize(x):
    """Standardizes the (complex) logarithm of a real number.

    The logarithm of a real number may be represented by a complex number with
    imaginary part that is a multiple of pi*1j. Even multiples correspond with
    a positive real and odd multiples correspond with a negative real.

    Given a logarithm of a real number `x`, this function returns an equivalent
    representation in a standard form: the log of a positive real has imaginary
    part `0` and the log of a negative real has imaginary part `pi`.

    """
    shape = x.shape
    x = np.atleast_1d(x)
    real = np.real(x).astype(x.dtype)
    complex = np.imag(x)
    y = real
    negative = np.exp(complex*1j) < 0.5
    y[negative] = y[negative] + np.pi * 1j
    return y.reshape(shape)[()]


def _combine_docs(dist_family, *, include_examples=True):
    fields = set(NumpyDocString.sections)
    fields.remove('index')
    if not include_examples:
        fields.remove('Examples')

    doc = ClassDoc(dist_family)
    superdoc = ClassDoc(UnivariateDistribution)
    for field in fields:
        if field in {"Methods", "Attributes"}:
            doc[field] = superdoc[field]
        elif field in {"Summary"}:
            pass
        elif field == "Extended Summary":
            doc[field].append(_generate_domain_support(dist_family))
        elif field == 'Examples':
            doc[field] = [_generate_example(dist_family)]
        else:
            doc[field] += superdoc[field]
    return str(doc)


def _generate_domain_support(dist_family):
    n_parameterizations = len(dist_family._parameterizations)

    domain = f"\nfor :math:`x \\in {dist_family._variable.domain}`.\n"

    if n_parameterizations == 0:
        support = """
        This class accepts no distribution parameters.
        """
    elif n_parameterizations == 1:
        support = f"""
        This class accepts one parameterization:
        {str(dist_family._parameterizations[0])}.
        """
    else:
        number = {2: 'two', 3: 'three', 4: 'four', 5: 'five'}[
            n_parameterizations]
        parameterizations = [f"- {str(p)}" for p in
                             dist_family._parameterizations]
        parameterizations = "\n".join(parameterizations)
        support = f"""
        This class accepts {number} parameterizations:

        {parameterizations}
        """
    support = "\n".join([line.lstrip() for line in support.split("\n")][1:])
    return domain + support


def _generate_example(dist_family):
    n_parameters = dist_family._num_parameters(0)
    shapes = [()] * n_parameters
    rng = np.random.default_rng(615681484984984)
    i = 0
    dist = dist_family._draw(shapes, rng=rng, i_parameterization=i)

    rng = np.random.default_rng(2354873452)
    name = dist_family.__name__
    if n_parameters:
        parameter_names = list(dist._parameterizations[i].parameters)
        parameter_values = [round(getattr(dist, name), 2) for name in
                            parameter_names]
        name_values = [f"{name}={value}" for name, value in
                       zip(parameter_names, parameter_values)]
        instantiation = f"{name}({', '.join(name_values)})"
        attributes = ", ".join([f"X.{param}" for param in dist._parameters])
        X = dist_family(**dict(zip(parameter_names, parameter_values)))
    else:
        instantiation = f"{name}()"
        X = dist

    p = 0.32
    x = round(X.icdf(p), 2)
    y = round(X.icdf(2 * p), 2)  # noqa: F841

    example = f"""
    To use the distribution class, it must be instantiated using keyword
    parameters corresponding with one of the accepted parameterizations.

    >>> import numpy as np
    >>> import matplotlib.pyplot as plt
    >>> from scipy import stats
    >>> from scipy.stats import {name}
    >>> X = {instantiation}

    For convenience, the ``plot`` method can be used to visualize the density
    and other functions of the distribution.

    >>> X.plot()
    >>> plt.show()

    The support of the underlying distribution is available using the ``support``
    method.

    >>> X.support()
    {X.support()}
    """

    if n_parameters:
        example += f"""
        The numerical values of parameters associated with all parameterizations
        are available as attributes.

        >>> {attributes}
        {tuple(X._parameters.values())}
        """

    example += f"""
    To evaluate the probability density/mass function of the underlying distribution
    at argument ``x={x}``:

    >>> x = {x}
    >>> X.pdf(x), X.pmf(x)
    {X.pdf(x), X.pmf(x)}

    The cumulative distribution function, its complement, and the logarithm
    of these functions are evaluated similarly.

    >>> np.allclose(np.exp(X.logccdf(x)), 1 - X.cdf(x))
    True
    """

    # When two-arg CDF is implemented for DiscreteDistribution, consider removing
    # the special-casing here.
    if issubclass(dist_family, ContinuousDistribution):
        example_continuous = f"""
    The inverse of these functions with respect to the argument ``x`` is also
    available.

    >>> logp = np.log(1 - X.ccdf(x))
    >>> np.allclose(X.ilogcdf(logp), x)
    True

    Note that distribution functions and their logarithms also have two-argument
    versions for working with the probability mass between two arguments. The
    result tends to be more accurate than the naive implementation because it avoids
    subtractive cancellation.

    >>> y = {y}
    >>> np.allclose(X.ccdf(x, y), 1 - (X.cdf(y) - X.cdf(x)))
    True
        """
        example += example_continuous

    example += f"""
    There are methods for computing measures of central tendency,
    dispersion, higher moments, and entropy.

    >>> X.mean(), X.median(), X.mode()
    {X.mean(), X.median(), X.mode()}

    >>> X.variance(), X.standard_deviation()
    {X.variance(), X.standard_deviation()}

    >>> X.skewness(), X.kurtosis()
    {X.skewness(), X.kurtosis()}

    >>> np.allclose(X.moment(order=6, kind='standardized'),
    ...             X.moment(order=6, kind='central') / X.variance()**3)
    True
    """

    # When logentropy is implemented for DiscreteDistribution, remove special-casing
    if issubclass(dist_family, ContinuousDistribution):
        example += """
    >>> np.allclose(np.exp(X.logentropy()), X.entropy())
    True
        """
    else:
        example += f"""
        >>> X.entropy()
        {X.entropy()}
        """

    example += f"""
    Pseudo-random samples can be drawn from
    the underlying distribution using ``sample``.

    >>> X.sample(shape=(4,))
    {repr(X.sample(shape=(4,)))}  # may vary
    """
    # remove the indentation due to use of block quote within function;
    # eliminate blank first line
    example = "\n".join([line.lstrip() for line in example.split("\n")][1:])
    return example


class UnivariateDistribution(_ProbabilityDistribution):
    r""" Class that represents a continuous statistical distribution.

    Parameters
    ----------
    tol : positive float, optional
        The desired relative tolerance of calculations. Left unspecified,
        calculations may be faster; when provided, calculations may be
        more likely to meet the desired accuracy.
    validation_policy : {None, "skip_all"}
        Specifies the level of input validation to perform. Left unspecified,
        input validation is performed to ensure appropriate behavior in edge
        case (e.g. parameters out of domain, argument outside of distribution
        support, etc.) and improve consistency of output dtype, shape, etc.
        Pass ``'skip_all'`` to avoid the computational overhead of these
        checks when rough edges are acceptable.
    cache_policy : {None, "no_cache"}
        Specifies the extent to which intermediate results are cached. Left
        unspecified, intermediate results of some calculations (e.g. distribution
        support, moments, etc.) are cached to improve performance of future
        calculations. Pass ``'no_cache'`` to reduce memory reserved by the class
        instance.

    Attributes
    ----------
    All parameters are available as attributes.

    Methods
    -------
    support

    plot

    sample

    moment

    mean
    median
    mode

    variance
    standard_deviation

    skewness
    kurtosis

    pdf
    logpdf

    cdf
    icdf
    ccdf
    iccdf

    logcdf
    ilogcdf
    logccdf
    ilogccdf

    entropy
    logentropy

    See Also
    --------
    :ref:`rv_infrastructure` : Tutorial

    Notes
    -----
    The following abbreviations are used throughout the documentation.

    - PDF: probability density function
    - CDF: cumulative distribution function
    - CCDF: complementary CDF
    - entropy: differential entropy
    - log-*F*: logarithm of *F* (e.g. log-CDF)
    - inverse *F*: inverse function of *F* (e.g. inverse CDF)

    The API documentation is written to describe the API, not to serve as
    a statistical reference. Effort is made to be correct at the level
    required to use the functionality, not to be mathematically rigorous.
    For example, continuity and differentiability may be implicitly assumed.
    For precise mathematical definitions, consult your preferred mathematical
    text.

    """
    __array_priority__ = 1
    _parameterizations = []  # type: ignore[var-annotated]

    ### Initialization

    def __init__(self, *, tol=_null, validation_policy=None, cache_policy=None,
                 **parameters):
        self.tol = tol
        self.validation_policy = validation_policy
        self.cache_policy = cache_policy
        self._not_implemented = (
            f"`{self.__class__.__name__}` does not provide an accurate "
            "implementation of the required method. Consider leaving "
            "`method` and `tol` unspecified to use another implementation."
        )
        self._original_parameters = {}
        # We may want to override the `__init__` method with parameters so
        # IDEs can suggest parameter names. If there are multiple parameterizations,
        # we'll need the default values of parameters to be None; this will
        # filter out the parameters that were not actually specified by the user.
        parameters = {key: val for key, val in
                      sorted(parameters.items()) if val is not None}
        self._update_parameters(**parameters)

    def _update_parameters(self, *, validation_policy=None, **params):
        r""" Update the numerical values of distribution parameters.

        Parameters
        ----------
        **params : array_like
            Desired numerical values of the distribution parameters. Any or all
            of the parameters initially used to instantiate the distribution
            may be modified. Parameters used in alternative parameterizations
            are not accepted.

        validation_policy : str
            To be documented. See Question 3 at the top.
        """

        parameters = original_parameters = self._original_parameters.copy()
        parameters.update(**params)
        parameterization = None
        self._invalid = np.asarray(False)
        self._any_invalid = False
        self._shape = tuple()
        self._ndim = 0
        self._size = 1
        self._dtype = np.float64

        if (validation_policy or self.validation_policy) == _SKIP_ALL:
            parameters = self._process_parameters(**parameters)
        elif not len(self._parameterizations):
            if parameters:
                message = (f"The `{self.__class__.__name__}` distribution "
                           "family does not accept parameters, but parameters "
                           f"`{set(parameters)}` were provided.")
                raise ValueError(message)
        else:
            # This is default behavior, which re-runs all parameter validations
            # even when only a single parameter is modified. For many
            # distributions, the domain of a parameter doesn't depend on other
            # parameters, so parameters could safely be modified without
            # re-validating all other parameters. To handle these cases more
            # efficiently, we could allow the developer  to override this
            # behavior.

            # Currently the user can only update the original parameterization.
            # Even though that parameterization is already known,
            # `_identify_parameterization` is called to produce a nice error
            # message if the user passes other values. To be a little more
            # efficient, we could detect whether the values passed are
            # consistent with the original parameterization rather than finding
            # it from scratch. However, we might want other parameterizations
            # to be accepted, which would require other changes, so I didn't
            # optimize this.

            parameterization = self._identify_parameterization(parameters)
            parameters, shape, size, ndim = self._broadcast(parameters)
            parameters, invalid, any_invalid, dtype = (
                self._validate(parameterization, parameters))
            parameters = self._process_parameters(**parameters)

            self._invalid = invalid
            self._any_invalid = any_invalid
            self._shape = shape
            self._size = size
            self._ndim = ndim
            self._dtype = dtype

        self.reset_cache()
        self._parameters = parameters
        self._parameterization = parameterization
        self._original_parameters = original_parameters
        for name in self._parameters.keys():
            # Make parameters properties of the class; return values from the instance
            if hasattr(self.__class__, name):
                continue
            setattr(self.__class__, name, property(lambda self_, name_=name:
                                                   self_._parameters[name_].copy()[()]))

    def reset_cache(self):
        r""" Clear all cached values.

        To improve the speed of some calculations, the distribution's support
        and moments are cached.

        This function is called automatically whenever the distribution
        parameters are updated.

        """
        # We could offer finer control over what is cleared.
        # For simplicity, these will still exist even if cache_policy is
        # NO_CACHE; they just won't be populated. This allows caching to be
        # turned on and off easily.
        self._moment_raw_cache = {}
        self._moment_central_cache = {}
        self._moment_standardized_cache = {}
        self._support_cache = None
        self._method_cache = {}
        self._constant_cache = None

    def _identify_parameterization(self, parameters):
        # Determine whether a `parameters` dictionary matches is consistent
        # with one of the parameterizations of the distribution. If so,
        # return that parameterization object; if not, raise an error.
        #
        # I've come back to this a few times wanting to avoid this explicit
        # loop. I've considered several possibilities, but they've all been a
        # little unusual. For example, we could override `_eq_` so we can
        # use _parameterizations.index() to retrieve the parameterization,
        # or the user could put the parameterizations in a dictionary so we
        # could look them up with a key (e.g. frozenset of parameter names).
        # I haven't been sure enough of these approaches to implement them.
        parameter_names_set = set(parameters)

        for parameterization in self._parameterizations:
            if parameterization.matches(parameter_names_set):
                break
        else:
            if not parameter_names_set:
                message = (f"The `{self.__class__.__name__}` distribution "
                           "family requires parameters, but none were "
                           "provided.")
            else:
                parameter_names = self._get_parameter_str(parameters)
                message = (f"The provided parameters `{parameter_names}` "
                           "do not match a supported parameterization of the "
                           f"`{self.__class__.__name__}` distribution family.")
            raise ValueError(message)

        return parameterization

    def _broadcast(self, parameters):
        # Broadcast the distribution parameters to the same shape. If the
        # arrays are not broadcastable, raise a meaningful error.
        #
        # We always make sure that the parameters *are* the same shape
        # and not just broadcastable. Users can access parameters as
        # attributes, and I think they should see the arrays as the same shape.
        # More importantly, arrays should be the same shape before logical
        # indexing operations, which are needed in infrastructure code when
        # there are invalid parameters, and may be needed in
        # distribution-specific code. We don't want developers to need to
        # broadcast in implementation functions.

        # It's much faster to check whether broadcasting is necessary than to
        # broadcast when it's not necessary.
        parameter_vals = [np.asarray(parameter)
                          for parameter in parameters.values()]
        parameter_shapes = set(parameter.shape for parameter in parameter_vals)
        if len(parameter_shapes) == 1:
            return (parameters, parameter_vals[0].shape,
                    parameter_vals[0].size, parameter_vals[0].ndim)

        try:
            parameter_vals = np.broadcast_arrays(*parameter_vals)
        except ValueError as e:
            parameter_names = self._get_parameter_str(parameters)
            message = (f"The parameters `{parameter_names}` provided to the "
                       f"`{self.__class__.__name__}` distribution family "
                       "cannot be broadcast to the same shape.")
            raise ValueError(message) from e
        return (dict(zip(parameters.keys(), parameter_vals)),
                parameter_vals[0].shape,
                parameter_vals[0].size,
                parameter_vals[0].ndim)

    def _validate(self, parameterization, parameters):
        # Broadcasts distribution parameter arrays and converts them to a
        # consistent dtype. Replaces invalid parameters with `np.nan`.
        # Returns the validated parameters, a boolean mask indicated *which*
        # elements are invalid, a boolean scalar indicating whether *any*
        # are invalid (to skip special treatments if none are invalid), and
        # the common dtype.
        valid, dtype = parameterization.validation(parameters)
        invalid = ~valid
        any_invalid = invalid if invalid.shape == () else np.any(invalid)
        # If necessary, make the arrays contiguous and replace invalid with NaN
        if any_invalid:
            for parameter_name in parameters:
                parameters[parameter_name] = np.copy(
                    parameters[parameter_name])
                parameters[parameter_name][invalid] = np.nan

        return parameters, invalid, any_invalid, dtype

    def _process_parameters(self, **params):
        r""" Process and cache distribution parameters for reuse.

        This is intended to be overridden by subclasses. It allows distribution
        authors to pre-process parameters for re-use. For instance, when a user
        parameterizes a LogUniform distribution with `a` and `b`, it makes
        sense to calculate `log(a)` and `log(b)` because these values will be
        used in almost all distribution methods. The dictionary returned by
        this method is passed to all private methods that calculate functions
        of the distribution.
        """
        return params

    def _get_parameter_str(self, parameters):
        # Get a string representation of the parameters like "{a, b, c}".
        return f"{{{', '.join(parameters.keys())}}}"

    def _copy_parameterization(self):
        self._parameterizations = self._parameterizations.copy()
        for i in range(len(self._parameterizations)):
            self._parameterizations[i] = self._parameterizations[i].copy()

    ### Attributes

    # `tol` attribute is just notional right now. See Question 4 above.
    @property
    def tol(self):
        r"""positive float:
        The desired relative tolerance of calculations. Left unspecified,
        calculations may be faster; when provided, calculations may be
        more likely to meet the desired accuracy.
        """
        return self._tol

    @tol.setter
    def tol(self, tol):
        if _isnull(tol):
            self._tol = tol
            return

        tol = np.asarray(tol)
        if (tol.shape != () or not tol > 0 or  # catches NaNs
                not np.issubdtype(tol.dtype, np.floating)):
            message = (f"Attribute `tol` of `{self.__class__.__name__}` must "
                       "be a positive float, if specified.")
            raise ValueError(message)
        self._tol = tol[()]

    @property
    def cache_policy(self):
        r"""{None, "no_cache"}:
        Specifies the extent to which intermediate results are cached. Left
        unspecified, intermediate results of some calculations (e.g. distribution
        support, moments, etc.) are cached to improve performance of future
        calculations. Pass ``'no_cache'`` to reduce memory reserved by the class
        instance.
        """
        return self._cache_policy

    @cache_policy.setter
    def cache_policy(self, cache_policy):
        cache_policy = str(cache_policy).lower() if cache_policy is not None else None
        cache_policies = {None, 'no_cache'}
        if cache_policy not in cache_policies:
            message = (f"Attribute `cache_policy` of `{self.__class__.__name__}` "
                       f"must be one of {cache_policies}, if specified.")
            raise ValueError(message)
        self._cache_policy = cache_policy

    @property
    def validation_policy(self):
        r"""{None, "skip_all"}:
        Specifies the level of input validation to perform. Left unspecified,
        input validation is performed to ensure appropriate behavior in edge
        case (e.g. parameters out of domain, argument outside of distribution
        support, etc.) and improve consistency of output dtype, shape, etc.
        Use ``'skip_all'`` to avoid the computational overhead of these
        checks when rough edges are acceptable.
        """
        return self._validation_policy

    @validation_policy.setter
    def validation_policy(self, validation_policy):
        validation_policy = (str(validation_policy).lower()
                             if validation_policy is not None else None)
        iv_policies = {None, 'skip_all'}
        if validation_policy not in iv_policies:
            message = (f"Attribute `validation_policy` of `{self.__class__.__name__}` "
                       f"must be one of {iv_policies}, if specified.")
            raise ValueError(message)
        self._validation_policy = validation_policy

    ### Other magic methods

    def __repr__(self):
        r""" Returns a string representation of the distribution.

        Includes the name of the distribution family, the names of the
        parameters and the `repr` of each of their values.


        """
        class_name = self.__class__.__name__
        parameters = list(self._original_parameters.items())
        info = []
        with np.printoptions(threshold=10):
            str_parameters = [f"{symbol}={repr(value)}" for symbol, value in parameters]
        str_parameters = f"{', '.join(str_parameters)}"
        info.append(str_parameters)
        return f"{class_name}({', '.join(info)})"

    def __str__(self):
        class_name = self.__class__.__name__
        parameters = list(self._original_parameters.items())
        info = []
        with np.printoptions(threshold=10):
            str_parameters = [f"{symbol}={str(value)}" for symbol, value in parameters]
        str_parameters = f"{', '.join(str_parameters)}"
        info.append(str_parameters)
        return f"{class_name}({', '.join(info)})"

    def __add__(self, loc):
        return ShiftedScaledDistribution(self, loc=loc)

    def __sub__(self, loc):
        return ShiftedScaledDistribution(self, loc=-loc)

    def __mul__(self, scale):
        return ShiftedScaledDistribution(self, scale=scale)

    def __truediv__(self, scale):
        return ShiftedScaledDistribution(self, scale=1/scale)

    def __pow__(self, other):
        if not np.isscalar(other) or other <= 0 or other != int(other):
            message = ("Raising a random variable to the power of an argument is only "
                       "implemented when the argument is a positive integer.")
            raise NotImplementedError(message)

        # Fill in repr_pattern with the repr of self before taking abs.
        # Avoids having unnecessary abs in the repr.
        with np.printoptions(threshold=10):
            repr_pattern = f"({repr(self)})**{repr(other)}"
            str_pattern = f"({str(self)})**{str(other)}"
        X = abs(self) if other % 2 == 0 else self

        funcs = dict(g=lambda u: u**other, repr_pattern=repr_pattern,
                     str_pattern=str_pattern,
                     h=lambda u: np.sign(u) * np.abs(u)**(1 / other),
                     dh=lambda u: 1/other * np.abs(u)**(1/other - 1))

        return MonotonicTransformedDistribution(X, **funcs, increasing=True)

    def __radd__(self, other):
        return self.__add__(other)

    def __rsub__(self, other):
        return self.__neg__().__add__(other)

    def __rmul__(self, other):
        return self.__mul__(other)

    def __rtruediv__(self, other):
        a, b = self.support()
        with np.printoptions(threshold=10):
            funcs = dict(g=lambda u: 1 / u,
                         repr_pattern=f"{repr(other)}/({repr(self)})",
                         str_pattern=f"{str(other)}/({str(self)})",
                         h=lambda u: 1 / u, dh=lambda u: 1 / u ** 2)
        if np.all(a >= 0) or np.all(b <= 0):
            out = MonotonicTransformedDistribution(self, **funcs, increasing=False)
        else:
            message = ("Division by a random variable is only implemented "
                       "when the support is either non-negative or non-positive.")
            raise NotImplementedError(message)
        if np.all(other == 1):
            return out
        else:
            return out * other

    def __rpow__(self, other):
        with np.printoptions(threshold=10):
            funcs = dict(g=lambda u: other**u,
                         h=lambda u: np.log(u) / np.log(other),
                         dh=lambda u: 1 / np.abs(u * np.log(other)),
                         repr_pattern=f"{repr(other)}**({repr(self)})",
                         str_pattern=f"{str(other)}**({str(self)})",)

        if not np.isscalar(other) or other <= 0 or other == 1:
            message = ("Raising an argument to the power of a random variable is only "
                       "implemented when the argument is a positive scalar other than "
                       "1.")
            raise NotImplementedError(message)

        if other > 1:
            return MonotonicTransformedDistribution(self, **funcs, increasing=True)
        else:
            return MonotonicTransformedDistribution(self, **funcs, increasing=False)

    def __neg__(self):
        return self * -1

    def __abs__(self):
        return FoldedDistribution(self)

    ### Utilities

    ## Input validation

    def _validate_order_kind(self, order, kind, kinds):
        # Yet another integer validating function. Unlike others in SciPy, it
        # Is quite flexible about what is allowed as an integer, and it
        # raises a distribution-specific error message to facilitate
        # identification of the source of the error.
        if self.validation_policy == _SKIP_ALL:
            return order

        order = np.asarray(order, dtype=self._dtype)[()]
        message = (f"Argument `order` of `{self.__class__.__name__}.moment` "
                   "must be a finite, positive integer.")
        try:
            order_int = round(order.item())
            # If this fails for any reason (e.g. it's an array, it's infinite)
            # it's not a valid `order`.
        except Exception as e:
            raise ValueError(message) from e

        if order_int <0 or order_int != order:
            raise ValueError(message)

        message = (f"Argument `kind` of `{self.__class__.__name__}.moment` "
                   f"must be one of {set(kinds)}.")
        if kind.lower() not in kinds:
            raise ValueError(message)

        return order

    def _preserve_type(self, x):
        x = np.asarray(x)
        if x.dtype != self._dtype:
            x = x.astype(self._dtype)
        return x[()]

    ## Testing

    @classmethod
    def _draw(cls, sizes=None, rng=None, i_parameterization=None,
              proportions=None):
        r""" Draw a specific (fully-defined) distribution from the family.

        See _Parameterization.draw for documentation details.
        """
        rng = np.random.default_rng(rng)
        if len(cls._parameterizations) == 0:
            return cls()
        if i_parameterization is None:
            n = cls._num_parameterizations()
            i_parameterization = rng.integers(0, max(0, n - 1), endpoint=True)

        parameterization = cls._parameterizations[i_parameterization]
        parameters = parameterization.draw(sizes, rng, proportions=proportions,
                                           region='typical')
        return cls(**parameters)

    @classmethod
    def _num_parameterizations(cls):
        # Returns the number of parameterizations accepted by the family.
        return len(cls._parameterizations)

    @classmethod
    def _num_parameters(cls, i_parameterization=0):
        # Returns the number of parameters used in the specified
        # parameterization.
        return (0 if not cls._num_parameterizations()
                else len(cls._parameterizations[i_parameterization]))

    ## Algorithms

    def _quadrature(self, integrand, limits=None, args=None,
                    params=None, log=False):
        # Performs numerical integration of an integrand between limits.
        # Much of this should be added to `_tanhsinh`.
        a, b = self._support(**params) if limits is None else limits
        a, b = np.broadcast_arrays(a, b)
        if not a.size:
            # maybe need to figure out result type from a, b
            return np.empty(a.shape, dtype=self._dtype)
        args = [] if args is None else args
        params = {} if params is None else params
        f, args = _kwargs2args(integrand, args=args, kwargs=params)
        args = np.broadcast_arrays(*args)
        # If we know the median or mean, consider breaking up the interval
        rtol = None if _isnull(self.tol) else self.tol
        # For now, we ignore the status, but I want to return the error
        # estimate - see question 5 at the top.
        if isinstance(self, ContinuousDistribution):
            res = _tanhsinh(f, a, b, args=args, log=log, rtol=rtol)
            return res.integral
        else:
            res = nsum(f, a, b, args=args, log=log, tolerances=dict(rtol=rtol)).sum
            res = np.asarray(res)
            # The result should be nan when parameters are nan, so need to special
            # case this.
            cond = np.isnan(params.popitem()[1]) if params else np.True_
            cond = np.broadcast_to(cond, a.shape)
            res[(a > b)] = -np.inf if log else 0  # fix in nsum?
            res[cond] = np.nan

            return res[()]

    def _solve_bounded(self, f, p, *, bounds=None, params=None, xatol=None):
        # Finds the argument of a function that produces the desired output.
        # Much of this should be added to _bracket_root / _chandrupatla.
        xmin, xmax = self._support(**params) if bounds is None else bounds
        params = {} if params is None else params

        p, xmin, xmax = np.broadcast_arrays(p, xmin, xmax)
        if not p.size:
            # might need to figure out result type based on p
            res = _RichResult()
            empty = np.empty(p.shape, dtype=self._dtype)
            res.xl, res.x, res.xr = empty, empty, empty
            res.fl, res.fr = empty, empty

        def f2(x, _p, **kwargs):  # named `_p` to avoid conflict with shape `p`
            return f(x, **kwargs) - _p

        f3, args = _kwargs2args(f2, args=[p], kwargs=params)
        # If we know the median or mean, should use it

        # Any operations between 0d array and a scalar produces a scalar, so...
        shape = xmin.shape
        xmin, xmax = np.atleast_1d(xmin, xmax)

        xl0, xr0 = _guess_bracket(xmin, xmax)
        xmin = xmin.reshape(shape)
        xmax = xmax.reshape(shape)
        xl0 = xl0.reshape(shape)
        xr0 = xr0.reshape(shape)

        res = _bracket_root(f3, xl0=xl0, xr0=xr0, xmin=xmin, xmax=xmax, args=args)
        # For now, we ignore the status, but I want to use the bracket width
        # as an error estimate - see question 5 at the top.

        xrtol = None if _isnull(self.tol) else self.tol
        xatol = None if xatol is None else xatol
        tolerances = dict(xrtol=xrtol, xatol=xatol, fatol=0, frtol=0)
        return _chandrupatla(f3, a=res.xl, b=res.xr, args=args, **tolerances)

    ## Other

    def _overrides(self, method_name):
        # Determines whether a class overrides a specified method.
        # Returns True if the method implementation exists and is the same as
        # that of the `ContinuousDistribution` class; otherwise returns False.

        # Sometimes we use `_overrides` to check whether a certain method is overridden
        # and if so, call it. This begs the questions of why we don't do the more
        # obvious thing: restructure so that if the private method is overridden,
        # Python will call it instead of the inherited version automatically. The short
        # answer is that there are multiple ways a use might wish to evaluate a method,
        # and simply overriding the method with a formula is not always the best option.
        # For more complete discussion of the considerations, see:
        # https://github.com/scipy/scipy/pull/21050#discussion_r1707798901
        method = getattr(self.__class__, method_name, None)
        super_method = getattr(UnivariateDistribution, method_name, None)
        return method is not super_method

    ### Distribution properties
    # The following "distribution properties" are exposed via a public method
    # that accepts only options (not distribution parameters or quantile/
    # percentile argument).
    # support
    # logentropy, entropy,
    # median, mode, mean,
    # variance, standard_deviation
    # skewness, kurtosis
    # Common options are:
    # method - a string that indicates which method should be used to compute
    #          the quantity (e.g. a formula or numerical integration).
    # Input/output validation is provided by the `_set_invalid_nan_property`
    # decorator. These are the methods meant to be called by users.
    #
    # Each public method calls a private "dispatch" method that
    # determines which "method" (strategy for calculating the desired quantity)
    # to use by default and, via the `@_dispatch` decorator, calls the
    # method and computes the result.
    # Dispatch methods always accept:
    # method - as passed from the public method
    # params - a dictionary of distribution shape parameters passed by
    #          the public method.
    # Dispatch methods accept `params` rather than relying on the state of the
    # object because iterative algorithms like `_tanhsinh` and `_chandrupatla`
    # need their callable to follow a strict elementwise protocol: each element
    # of the output is determined solely by the values of the inputs at the
    # corresponding location. The public methods do not satisfy this protocol
    # because they do not accept the parameters as arguments, producing an
    # output that generally has a different shape than that of the input. Also,
    # by calling "dispatch" methods rather than the public methods, the
    # iterative algorithms avoid the overhead of input validation.
    #
    # Each dispatch method can designate the responsibility of computing
    # the required value to any of several "implementation" methods. These
    # methods accept only `**params`, the parameter dictionary passed from
    # the public method via the dispatch method. We separate the implementation
    # methods from the dispatch methods for the sake of simplicity (via
    # compartmentalization) and to allow subclasses to override certain
    # implementation methods (typically only the "formula" methods). The names
    # of implementation methods are combinations of the public method name and
    # the name of the "method" (strategy for calculating the desired quantity)
    # string. (In fact, the name of the implementation method is calculated
    # from these two strings in the `_dispatch` decorator.) Common method
    # strings are:
    # formula - distribution-specific analytical expressions to be implemented
    #           by subclasses.
    # log/exp - Compute the log of a number and then exponentiate it or vice
    #           versa.
    # quadrature - Compute the value via numerical integration.
    #
    # The default method (strategy) is determined based on what implementation
    # methods are available and the error tolerance of the user. Typically,
    # a formula is always used if available. We fall back to "log/exp" if a
    # formula for the logarithm or exponential of the quantity is available,
    # and we use quadrature otherwise.

    def support(self):
        # If this were a `cached_property`, we couldn't update the value
        # when the distribution parameters change.
        # Caching is important, though, because calls to _support take a few
        # microseconds even when `a` and `b` are already the same shape.
        if self._support_cache is not None:
            return self._support_cache

        a, b = self._support(**self._parameters)
        if a.shape != self._shape:
            a = np.broadcast_to(a, self._shape)
        if b.shape != self._shape:
            b = np.broadcast_to(b, self._shape)

        if self._any_invalid:
            a, b = np.asarray(a).copy(), np.asarray(b).copy()
            a[self._invalid], b[self._invalid] = np.nan, np.nan
            a, b = a[()], b[()]

        support = (a, b)

        if self.cache_policy != _NO_CACHE:
            self._support_cache = support

        return support

    def _support(self, **params):
        # Computes the support given distribution parameters
        a, b = self._variable.domain.get_numerical_endpoints(params)
        if len(params):
            # the parameters should all be of the same dtype and shape at this point
            vals = list(params.values())
            shape = vals[0].shape
            a = np.broadcast_to(a, shape) if a.shape != shape else a
            b = np.broadcast_to(b, shape) if b.shape != shape else b
        return self._preserve_type(a), self._preserve_type(b)

    @_set_invalid_nan_property
    def logentropy(self, *, method=None):
        return self._logentropy_dispatch(method=method, **self._parameters) + 0j

    @_dispatch
    def _logentropy_dispatch(self, method=None, **params):
        if self._overrides('_logentropy_formula'):
            method = self._logentropy_formula
        elif self._overrides('_entropy_formula'):
            method = self._logentropy_logexp_safe
        else:
            method = self._logentropy_quadrature
        return method

    def _logentropy_formula(self, **params):
        raise NotImplementedError(self._not_implemented)

    def _logentropy_logexp(self, **params):
        res = np.log(self._entropy_dispatch(**params)+0j)
        return _log_real_standardize(res)

    def _logentropy_logexp_safe(self, **params):
        out = self._logentropy_logexp(**params)
        mask = np.isinf(out.real)
        if np.any(mask):
            params_mask = {key:val[mask] for key, val in params.items()}
            out = np.asarray(out)
            out[mask] = self._logentropy_quadrature(**params_mask)
        return out[()]

    def _logentropy_quadrature(self, **params):
        def logintegrand(x, **params):
            logpxf = self._logpxf_dispatch(x, **params)
            return logpxf + np.log(0j+logpxf)
        res = self._quadrature(logintegrand, params=params, log=True)
        return _log_real_standardize(res + np.pi*1j)

    @_set_invalid_nan_property
    def entropy(self, *, method=None):
        return self._entropy_dispatch(method=method, **self._parameters)

    @_dispatch
    def _entropy_dispatch(self, method=None, **params):
        if self._overrides('_entropy_formula'):
            method = self._entropy_formula
        elif self._overrides('_logentropy_formula'):
            method = self._entropy_logexp
        else:
            method = self._entropy_quadrature
        return method

    def _entropy_formula(self, **params):
        raise NotImplementedError(self._not_implemented)

    def _entropy_logexp(self, **params):
        return np.real(np.exp(self._logentropy_dispatch(**params)))

    def _entropy_quadrature(self, **params):
        def integrand(x, **params):
            pxf = self._pxf_dispatch(x, **params)
            logpxf = self._logpxf_dispatch(x, **params)
            temp = np.asarray(pxf)
            i = (pxf != 0)  # 0 * inf -> nan; should be 0
            temp[i] = pxf[i]*logpxf[i]
            return temp
        return -self._quadrature(integrand, params=params)

    @_set_invalid_nan_property
    def median(self, *, method=None):
        return self._median_dispatch(method=method, **self._parameters)

    @_dispatch
    def _median_dispatch(self, method=None, **params):
        if self._overrides('_median_formula'):
            method = self._median_formula
        else:
            method = self._median_icdf
        return method

    def _median_formula(self, **params):
        raise NotImplementedError(self._not_implemented)

    def _median_icdf(self, **params):
        return self._icdf_dispatch(0.5, **params)

    @_set_invalid_nan_property
    def mode(self, *, method=None):
        return self._mode_dispatch(method=method, **self._parameters)

    @_dispatch
    def _mode_dispatch(self, method=None, **params):
        # We could add a method that looks for a critical point with
        # differentiation and the root finder
        if self._overrides('_mode_formula'):
            method = self._mode_formula
        else:
            method = self._mode_optimization
        return method

    def _mode_formula(self, **params):
        raise NotImplementedError(self._not_implemented)

    def _mode_optimization(self, xatol=None, **params):
        if not self._size:
            return np.empty(self._shape, dtype=self._dtype)

        a, b = self._support(**params)
        m = self._median_dispatch(**params)

        f, args = _kwargs2args(lambda x, **params: -self._pxf_dispatch(x, **params),
                               args=(), kwargs=params)
        res_b = _bracket_minimum(f, m, xmin=a, xmax=b, args=args)
        res = _chandrupatla_minimize(f, res_b.xl, res_b.xm, res_b.xr,
                                     args=args, xatol=xatol)
        mode = np.asarray(res.x)
        mode_at_boundary = res_b.status == -1
        mode_at_left = mode_at_boundary & (res_b.fl <= res_b.fm)
        mode_at_right = mode_at_boundary & (res_b.fr < res_b.fm)
        mode[mode_at_left] = a[mode_at_left]
        mode[mode_at_right] = b[mode_at_right]
        return mode[()]

    def mean(self, *, method=None):
        return self.moment(1, kind='raw', method=method)

    def variance(self, *, method=None):
        return self.moment(2, kind='central', method=method)

    def standard_deviation(self, *, method=None):
        return np.sqrt(self.variance(method=method))

    def skewness(self, *, method=None):
        return self.moment(3, kind='standardized', method=method)

    def kurtosis(self, *, method=None, convention='non-excess'):
        conventions = {'non-excess', 'excess'}
        message = (f'Parameter `convention` of `{self.__class__.__name__}.kurtosis` '
                   f"must be one of {conventions}.")
        convention = convention.lower()
        if convention not in conventions:
            raise ValueError(message)
        k = self.moment(4, kind='standardized', method=method)
        return k - 3 if convention == 'excess' else k

    ### Distribution functions
    # The following functions related to the distribution PDF and CDF are
    # exposed via a public method that accepts one positional argument - the
    # quantile - and keyword options (but not distribution parameters).
    # logpdf, pdf
    # logcdf, cdf
    # logccdf, ccdf
    # The `logcdf` and `cdf` functions can also be called with two positional
    # arguments - lower and upper quantiles - and they return the probability
    # mass (integral of the PDF) between them. The 2-arg versions of `logccdf`
    # and `ccdf` return the complement of this quantity.
    # All the (1-arg) cumulative distribution functions have inverse
    # functions, which accept one positional argument - the percentile.
    # ilogcdf, icdf
    # ilogccdf, iccdf
    # Common keyword options include:
    # method - a string that indicates which method should be used to compute
    #          the quantity (e.g. a formula or numerical integration).
    # Tolerance options should be added.
    # Input/output validation is provided by the `_set_invalid_nan`
    # decorator. These are the methods meant to be called by users.
    #
    # Each public method calls a private "dispatch" method that
    # determines which "method" (strategy for calculating the desired quantity)
    # to use by default and, via the `@_dispatch` decorator, calls the
    # method and computes the result.
    # Each dispatch method can designate the responsibility of computing
    # the required value to any of several "implementation" methods. These
    # methods accept only `**params`, the parameter dictionary passed from
    # the public method via the dispatch method.
    # See the note corresponding with the "Distribution Parameters" for more
    # information.

    ## Probability Density/Mass Functions

    @_set_invalid_nan
    def logpdf(self, x, /, *, method=None):
        return self._logpdf_dispatch(x, method=method, **self._parameters)

    @_dispatch
    def _logpdf_dispatch(self, x, *, method=None, **params):
        if self._overrides('_logpdf_formula'):
            method = self._logpdf_formula
        elif _isnull(self.tol):  # ensure that developers override _logpdf
            method = self._logpdf_logexp
        return method

    def _logpdf_formula(self, x, **params):
        raise NotImplementedError(self._not_implemented)

    def _logpdf_logexp(self, x, **params):
        return np.log(self._pdf_dispatch(x, **params))

    @_set_invalid_nan
    def pdf(self, x, /, *, method=None):
        return self._pdf_dispatch(x, method=method, **self._parameters)

    @_dispatch
    def _pdf_dispatch(self, x, *, method=None, **params):
        if self._overrides('_pdf_formula'):
            method = self._pdf_formula
        else:
            method = self._pdf_logexp
        return method

    def _pdf_formula(self, x, **params):
        raise NotImplementedError(self._not_implemented)

    def _pdf_logexp(self, x, **params):
        return np.exp(self._logpdf_dispatch(x, **params))

    @_set_invalid_nan
    def logpmf(self, x, /, *, method=None):
        return self._logpmf_dispatch(x, method=method, **self._parameters)

    @_dispatch
    def _logpmf_dispatch(self, x, *, method=None, **params):
        if self._overrides('_logpmf_formula'):
            method = self._logpmf_formula
        elif _isnull(self.tol):  # ensure that developers override _logpmf
            method = self._logpmf_logexp
        return method

    def _logpmf_formula(self, x, **params):
        raise NotImplementedError(self._not_implemented)

    def _logpmf_logexp(self, x, **params):
        with np.errstate(divide='ignore'):
            return np.log(self._pmf_dispatch(x, **params))

    @_set_invalid_nan
    def pmf(self, x, /, *, method=None):
        return self._pmf_dispatch(x, method=method, **self._parameters)

    @_dispatch
    def _pmf_dispatch(self, x, *, method=None, **params):
        if self._overrides('_pmf_formula'):
            method = self._pmf_formula
        else:
            method = self._pmf_logexp
        return method

    def _pmf_formula(self, x, **params):
        raise NotImplementedError(self._not_implemented)

    def _pmf_logexp(self, x, **params):
        return np.exp(self._logpmf_dispatch(x, **params))

    ## Cumulative Distribution Functions

    def logcdf(self, x, y=None, /, *, method=None):
        if y is None:
            return self._logcdf1(x, method=method)
        else:
            return self._logcdf2(x, y, method=method)

    @_cdf2_input_validation
    def _logcdf2(self, x, y, *, method):
        out = self._logcdf2_dispatch(x, y, method=method, **self._parameters)
        return (out + 0j) if not np.issubdtype(out.dtype, np.complexfloating) else out

    @_dispatch
    def _logcdf2_dispatch(self, x, y, *, method=None, **params):
        # dtype is complex if any x > y, else real
        # Should revisit this logic.
        if self._overrides('_logcdf2_formula'):
            method = self._logcdf2_formula
        elif (self._overrides('_logcdf_formula')
              or self._overrides('_logccdf_formula')):
            method = self._logcdf2_subtraction
        elif (self._overrides('_cdf_formula')
              or self._overrides('_ccdf_formula')):
            method = self._logcdf2_logexp_safe
        else:
            method = self._logcdf2_quadrature
        return method

    def _logcdf2_formula(self, x, y, **params):
        raise NotImplementedError(self._not_implemented)

    def _logcdf2_subtraction(self, x, y, **params):
        flip_sign = x > y  # some results will be negative
        x, y = np.minimum(x, y), np.maximum(x, y)
        logcdf_x = self._logcdf_dispatch(x, **params)
        logcdf_y = self._logcdf_dispatch(y, **params)
        logccdf_x = self._logccdf_dispatch(x, **params)
        logccdf_y = self._logccdf_dispatch(y, **params)
        case_left = (logcdf_x < -1) & (logcdf_y < -1)
        case_right = (logccdf_x < -1) & (logccdf_y < -1)
        case_central = ~(case_left | case_right)
        log_mass = _logexpxmexpy(logcdf_y, logcdf_x)
        log_mass[case_right] = _logexpxmexpy(logccdf_x, logccdf_y)[case_right]
        log_tail = np.logaddexp(logcdf_x, logccdf_y)[case_central]
        log_mass[case_central] = _log1mexp(log_tail)
        log_mass[flip_sign] += np.pi * 1j
        return log_mass[()] if np.any(flip_sign) else log_mass.real[()]

    def _logcdf2_logexp(self, x, y, **params):
        expres = self._cdf2_dispatch(x, y, **params)
        expres = expres + 0j if np.any(x > y) else expres
        return np.log(expres)

    def _logcdf2_logexp_safe(self, x, y, **params):
        out = self._logcdf2_logexp(x, y, **params)
        mask = np.isinf(out.real)
        if np.any(mask):
            params_mask = {key: np.broadcast_to(val, mask.shape)[mask]
                           for key, val in params.items()}
            out = np.asarray(out)
            out[mask] = self._logcdf2_quadrature(x[mask], y[mask], **params_mask)
        return out[()]

    def _logcdf2_quadrature(self, x, y, **params):
        logres = self._quadrature(self._logpxf_dispatch, limits=(x, y),
                                  log=True, params=params)
        return logres

    @_set_invalid_nan
    def _logcdf1(self, x, *, method=None):
        return self._logcdf_dispatch(x, method=method, **self._parameters)

    @_dispatch
    def _logcdf_dispatch(self, x, *, method=None, **params):
        if self._overrides('_logcdf_formula'):
            method = self._logcdf_formula
        elif self._overrides('_logccdf_formula'):
            method = self._logcdf_complement
        elif self._overrides('_cdf_formula'):
            method = self._logcdf_logexp_safe
        else:
            method = self._logcdf_quadrature
        return method

    def _logcdf_formula(self, x, **params):
        raise NotImplementedError(self._not_implemented)

    def _logcdf_complement(self, x, **params):
        return _log1mexp(self._logccdf_dispatch(x, **params))

    def _logcdf_logexp(self, x, **params):
        return np.log(self._cdf_dispatch(x, **params))

    def _logcdf_logexp_safe(self, x, **params):
        out = self._logcdf_logexp(x, **params)
        mask = np.isinf(out)
        if np.any(mask):
            params_mask = {key:np.broadcast_to(val, mask.shape)[mask]
                           for key, val in params.items()}
            out = np.asarray(out)
            out[mask] = self._logcdf_quadrature(x[mask], **params_mask)
        return out[()]

    def _logcdf_quadrature(self, x, **params):
        a, _ = self._support(**params)
        return self._quadrature(self._logpxf_dispatch, limits=(a, x),
                                params=params, log=True)

    def cdf(self, x, y=None, /, *, method=None):
        if y is None:
            return self._cdf1(x, method=method)
        else:
            return self._cdf2(x, y, method=method)

    @_cdf2_input_validation
    def _cdf2(self, x, y, *, method):
        return self._cdf2_dispatch(x, y, method=method, **self._parameters)

    @_dispatch
    def _cdf2_dispatch(self, x, y, *, method=None, **params):
        # Should revisit this logic.
        if self._overrides('_cdf2_formula'):
            method = self._cdf2_formula
        elif (self._overrides('_logcdf_formula')
              or self._overrides('_logccdf_formula')):
            method = self._cdf2_logexp
        elif self._overrides('_cdf_formula') or self._overrides('_ccdf_formula'):
            method = self._cdf2_subtraction_safe
        else:
            method = self._cdf2_quadrature
        return method

    def _cdf2_formula(self, x, y, **params):
        raise NotImplementedError(self._not_implemented)

    def _cdf2_logexp(self, x, y, **params):
        return np.real(np.exp(self._logcdf2_dispatch(x, y, **params)))

    def _cdf2_subtraction(self, x, y, **params):
        # Improvements:
        # Lazy evaluation of cdf/ccdf only where needed
        # Stack x and y to reduce function calls?
        cdf_x = self._cdf_dispatch(x, **params)
        cdf_y = self._cdf_dispatch(y, **params)
        ccdf_x = self._ccdf_dispatch(x, **params)
        ccdf_y = self._ccdf_dispatch(y, **params)
        i = (ccdf_x < 0.5) & (ccdf_y < 0.5)
        return np.where(i, ccdf_x-ccdf_y, cdf_y-cdf_x)

    def _cdf2_subtraction_safe(self, x, y, **params):
        cdf_x = self._cdf_dispatch(x, **params)
        cdf_y = self._cdf_dispatch(y, **params)
        ccdf_x = self._ccdf_dispatch(x, **params)
        ccdf_y = self._ccdf_dispatch(y, **params)
        i = (ccdf_x < 0.5) & (ccdf_y < 0.5)
        out = np.where(i, ccdf_x-ccdf_y, cdf_y-cdf_x)

        eps = np.finfo(self._dtype).eps
        tol = self.tol if not _isnull(self.tol) else np.sqrt(eps)

        cdf_max = np.maximum(cdf_x, cdf_y)
        ccdf_max = np.maximum(ccdf_x, ccdf_y)
        spacing = np.spacing(np.where(i, ccdf_max, cdf_max))
        mask = np.abs(tol * out) < spacing

        if np.any(mask):
            params_mask = {key: np.broadcast_to(val, mask.shape)[mask]
                           for key, val in params.items()}
            out = np.asarray(out)
            out[mask] = self._cdf2_quadrature(x[mask], y[mask], **params_mask)
        return out[()]

    def _cdf2_quadrature(self, x, y, **params):
        return self._quadrature(self._pxf_dispatch, limits=(x, y), params=params)

    @_set_invalid_nan
    def _cdf1(self, x, *, method):
        return self._cdf_dispatch(x, method=method, **self._parameters)

    @_dispatch
    def _cdf_dispatch(self, x, *, method=None, **params):
        if self._overrides('_cdf_formula'):
            method = self._cdf_formula
        elif self._overrides('_logcdf_formula'):
            method = self._cdf_logexp
        elif self._overrides('_ccdf_formula'):
            method = self._cdf_complement_safe
        else:
            method = self._cdf_quadrature
        return method

    def _cdf_formula(self, x, **params):
        raise NotImplementedError(self._not_implemented)

    def _cdf_logexp(self, x, **params):
        return np.exp(self._logcdf_dispatch(x, **params))

    def _cdf_complement(self, x, **params):
        return 1 - self._ccdf_dispatch(x, **params)

    def _cdf_complement_safe(self, x, **params):
        ccdf = self._ccdf_dispatch(x, **params)
        out = 1 - ccdf
        eps = np.finfo(self._dtype).eps
        tol = self.tol if not _isnull(self.tol) else np.sqrt(eps)
        mask = tol * out < np.spacing(ccdf)
        if np.any(mask):
            params_mask = {key: np.broadcast_to(val, mask.shape)[mask]
                           for key, val in params.items()}
            out = np.asarray(out)
            out[mask] = self._cdf_quadrature(x[mask], *params_mask)
        return out[()]

    def _cdf_quadrature(self, x, **params):
        a, _ = self._support(**params)
        return self._quadrature(self._pxf_dispatch, limits=(a, x),
                                params=params)

    def logccdf(self, x, y=None, /, *, method=None):
        if y is None:
            return self._logccdf1(x, method=method)
        else:
            return self._logccdf2(x, y, method=method)

    @_cdf2_input_validation
    def _logccdf2(self, x, y, *, method):
        return self._logccdf2_dispatch(x, y, method=method, **self._parameters)

    @_dispatch
    def _logccdf2_dispatch(self, x, y, *, method=None, **params):
        # if _logccdf2_formula exists, we could use the complement
        # if _ccdf2_formula exists, we could use log/exp
        if self._overrides('_logccdf2_formula'):
            method = self._logccdf2_formula
        else:
            method = self._logccdf2_addition
        return method

    def _logccdf2_formula(self, x, y, **params):
        raise NotImplementedError(self._not_implemented)

    def _logccdf2_addition(self, x, y, **params):
        logcdf_x = self._logcdf_dispatch(x, **params)
        logccdf_y = self._logccdf_dispatch(y, **params)
        return special.logsumexp([logcdf_x, logccdf_y], axis=0)

    @_set_invalid_nan
    def _logccdf1(self, x, *, method=None):
        return self._logccdf_dispatch(x, method=method, **self._parameters)

    @_dispatch
    def _logccdf_dispatch(self, x, method=None, **params):
        if self._overrides('_logccdf_formula'):
            method = self._logccdf_formula
        elif self._overrides('_logcdf_formula'):
            method = self._logccdf_complement
        elif self._overrides('_ccdf_formula'):
            method = self._logccdf_logexp_safe
        else:
            method = self._logccdf_quadrature
        return method

    def _logccdf_formula(self, x, **params):
        raise NotImplementedError(self._not_implemented)

    def _logccdf_complement(self, x, **params):
        return _log1mexp(self._logcdf_dispatch(x, **params))

    def _logccdf_logexp(self, x, **params):
        return np.log(self._ccdf_dispatch(x, **params))

    def _logccdf_logexp_safe(self, x, **params):
        out = self._logccdf_logexp(x, **params)
        mask = np.isinf(out)
        if np.any(mask):
            params_mask = {key: np.broadcast_to(val, mask.shape)[mask]
                           for key, val in params.items()}
            out = np.asarray(out)
            out[mask] = self._logccdf_quadrature(x[mask], **params_mask)
        return out[()]

    def _logccdf_quadrature(self, x, **params):
        _, b = self._support(**params)
        return self._quadrature(self._logpxf_dispatch, limits=(x, b),
                                params=params, log=True)

    def ccdf(self, x, y=None, /, *, method=None):
        if y is None:
            return self._ccdf1(x, method=method)
        else:
            return self._ccdf2(x, y, method=method)

    @_cdf2_input_validation
    def _ccdf2(self, x, y, *, method):
        return self._ccdf2_dispatch(x, y, method=method, **self._parameters)

    @_dispatch
    def _ccdf2_dispatch(self, x, y, *, method=None, **params):
        if self._overrides('_ccdf2_formula'):
            method = self._ccdf2_formula
        else:
            method = self._ccdf2_addition
        return method

    def _ccdf2_formula(self, x, y, **params):
        raise NotImplementedError(self._not_implemented)

    def _ccdf2_addition(self, x, y, **params):
        cdf_x = self._cdf_dispatch(x, **params)
        ccdf_y = self._ccdf_dispatch(y, **params)
        # even if x > y, cdf(x, y) + ccdf(x,y) sums to 1
        return cdf_x + ccdf_y

    @_set_invalid_nan
    def _ccdf1(self, x, *, method):
        return self._ccdf_dispatch(x, method=method, **self._parameters)

    @_dispatch
    def _ccdf_dispatch(self, x, method=None, **params):
        if self._overrides('_ccdf_formula'):
            method = self._ccdf_formula
        elif self._overrides('_logccdf_formula'):
            method = self._ccdf_logexp
        elif self._overrides('_cdf_formula'):
            method = self._ccdf_complement_safe
        else:
            method = self._ccdf_quadrature
        return method

    def _ccdf_formula(self, x, **params):
        raise NotImplementedError(self._not_implemented)

    def _ccdf_logexp(self, x, **params):
        return np.exp(self._logccdf_dispatch(x, **params))

    def _ccdf_complement(self, x, **params):
        return 1 - self._cdf_dispatch(x, **params)

    def _ccdf_complement_safe(self, x, **params):
        cdf = self._cdf_dispatch(x, **params)
        out = 1 - cdf
        eps = np.finfo(self._dtype).eps
        tol = self.tol if not _isnull(self.tol) else np.sqrt(eps)
        mask = tol * out < np.spacing(cdf)
        if np.any(mask):
            params_mask = {key: np.broadcast_to(val, mask.shape)[mask]
                           for key, val in params.items()}
            out = np.asarray(out)
            out[mask] = self._ccdf_quadrature(x[mask], **params_mask)
        return out[()]

    def _ccdf_quadrature(self, x, **params):
        _, b = self._support(**params)
        return self._quadrature(self._pxf_dispatch, limits=(x, b),
                                params=params)

    ## Inverse cumulative distribution functions

    @_set_invalid_nan
    def ilogcdf(self, logp, /, *, method=None):
        return self._ilogcdf_dispatch(logp, method=method, **self._parameters)

    @_dispatch
    def _ilogcdf_dispatch(self, x, method=None, **params):
        if self._overrides('_ilogcdf_formula'):
            method = self._ilogcdf_formula
        elif self._overrides('_ilogccdf_formula'):
            method = self._ilogcdf_complement
        else:
            method = self._ilogcdf_inversion
        return method

    def _ilogcdf_formula(self, x, **params):
        raise NotImplementedError(self._not_implemented)

    def _ilogcdf_complement(self, x, **params):
        return self._ilogccdf_dispatch(_log1mexp(x), **params)

    def _ilogcdf_inversion(self, x, **params):
        return self._solve_bounded_continuous(self._logcdf_dispatch, x, params=params)

    @_set_invalid_nan
    def icdf(self, p, /, *, method=None):
        return self._icdf_dispatch(p, method=method, **self._parameters)

    @_dispatch
    def _icdf_dispatch(self, x, method=None, **params):
        if self._overrides('_icdf_formula'):
            method = self._icdf_formula
        elif self._overrides('_iccdf_formula'):
            method = self._icdf_complement_safe
        else:
            method = self._icdf_inversion
        return method

    def _icdf_formula(self, x, **params):
        raise NotImplementedError(self._not_implemented)

    def _icdf_complement(self, x, **params):
        return self._iccdf_dispatch(1 - x, **params)

    def _icdf_complement_safe(self, x, **params):
        out = self._icdf_complement(x, **params)
        eps = np.finfo(self._dtype).eps
        tol = self.tol if not _isnull(self.tol) else np.sqrt(eps)
        mask = tol * x < np.spacing(1 - x)
        if np.any(mask):
            params_mask = {key: np.broadcast_to(val, mask.shape)[mask]
                           for key, val in params.items()}
            out = np.asarray(out)
            out[mask] = self._icdf_inversion(x[mask], *params_mask)
        return out[()]

    def _icdf_inversion(self, x, **params):
        return self._solve_bounded_continuous(self._cdf_dispatch, x, params=params)

    @_set_invalid_nan
    def ilogccdf(self, logp, /, *, method=None):
        return self._ilogccdf_dispatch(logp, method=method, **self._parameters)

    @_dispatch
    def _ilogccdf_dispatch(self, x, method=None, **params):
        if self._overrides('_ilogccdf_formula'):
            method = self._ilogccdf_formula
        elif self._overrides('_ilogcdf_formula'):
            method = self._ilogccdf_complement
        else:
            method = self._ilogccdf_inversion
        return method

    def _ilogccdf_formula(self, x, **params):
        raise NotImplementedError(self._not_implemented)

    def _ilogccdf_complement(self, x, **params):
        return self._ilogcdf_dispatch(_log1mexp(x), **params)

    def _ilogccdf_inversion(self, x, **params):
        return self._solve_bounded_continuous(self._logccdf_dispatch, x, params=params)

    @_set_invalid_nan
    def iccdf(self, p, /, *, method=None):
        return self._iccdf_dispatch(p, method=method, **self._parameters)

    @_dispatch
    def _iccdf_dispatch(self, x, method=None, **params):
        if self._overrides('_iccdf_formula'):
            method = self._iccdf_formula
        elif self._overrides('_icdf_formula'):
            method = self._iccdf_complement_safe
        else:
            method = self._iccdf_inversion
        return method

    def _iccdf_formula(self, x, **params):
        raise NotImplementedError(self._not_implemented)

    def _iccdf_complement(self, x, **params):
        return self._icdf_dispatch(1 - x, **params)

    def _iccdf_complement_safe(self, x, **params):
        out = self._iccdf_complement(x, **params)
        eps = np.finfo(self._dtype).eps
        tol = self.tol if not _isnull(self.tol) else np.sqrt(eps)
        mask = tol * x < np.spacing(1 - x)
        if np.any(mask):
            params_mask = {key: np.broadcast_to(val, mask.shape)[mask]
                           for key, val in params.items()}
            out = np.asarray(out)
            out[mask] = self._iccdf_inversion(x[mask], *params_mask)
        return out[()]

    def _iccdf_inversion(self, x, **params):
        return self._solve_bounded_continuous(self._ccdf_dispatch, x, params=params)

    ### Sampling Functions
    # The following functions for drawing samples from the distribution are
    # exposed via a public method that accepts one positional argument - the
    # shape of the sample - and keyword options (but not distribution
    # parameters).
    # sample
    # ~~qmc_sample~~ built into sample now
    #
    # Common keyword options include:
    # method - a string that indicates which method should be used to compute
    #          the quantity (e.g. a formula or numerical integration).
    # rng - the NumPy Generator/SciPy QMCEngine object to used for drawing numbers.
    #
    # Input/output validation is included in each function, since there is
    # little code to be shared.
    # These are the methods meant to be called by users.
    #
    # Each public method calls a private "dispatch" method that
    # determines which "method" (strategy for calculating the desired quantity)
    # to use by default and, via the `@_dispatch` decorator, calls the
    # method and computes the result.
    # Each dispatch method can designate the responsibility of sampling to any
    # of several "implementation" methods. These methods accept only
    # `**params`, the parameter dictionary passed from the public method via
    # the "dispatch" method.
    # See the note corresponding with the "Distribution Parameters" for more
    # information.

    # TODO:
    #  - should we accept a QRNG with `d != 1`?
    def sample(self, shape=(), *, method=None, rng=None):
        # needs output validation to ensure that developer returns correct
        # dtype and shape
        sample_shape = (shape,) if not np.iterable(shape) else tuple(shape)
        full_shape = sample_shape + self._shape
        rng = np.random.default_rng(rng) if not isinstance(rng, qmc.QMCEngine) else rng
        res = self._sample_dispatch(full_shape, method=method, rng=rng,
                                    **self._parameters)

        return res.astype(self._dtype, copy=False)

    @_dispatch
    def _sample_dispatch(self, full_shape, *, method, rng, **params):
        # make sure that tests catch if sample is 0d array
        if self._overrides('_sample_formula') and not isinstance(rng, qmc.QMCEngine):
            method = self._sample_formula
        else:
            method = self._sample_inverse_transform
        return method

    def _sample_formula(self, full_shape, *, rng, **params):
        raise NotImplementedError(self._not_implemented)

    def _sample_inverse_transform(self, full_shape, *, rng, **params):
        if isinstance(rng, qmc.QMCEngine):
            uniform = self._qmc_uniform(full_shape, qrng=rng, **params)
        else:
            uniform = rng.random(size=full_shape, dtype=self._dtype)
        return self._icdf_dispatch(uniform, **params)

    def _qmc_uniform(self, full_shape, *, qrng, **params):
        # Generate QMC uniform sample(s) on unit interval with specified shape;
        # if `sample_shape != ()`, then each slice along axis 0 is independent.

        sample_shape = full_shape[:len(full_shape)-len(self._shape)]
        # Determine the number of independent sequences and the length of each.
        n_low_discrepancy = sample_shape[0] if sample_shape else 1
        n_independent = math.prod(full_shape[1:] if sample_shape else full_shape)

        # For each independent sequence, we'll need a new QRNG of the appropriate class
        # with its own RNG. (If scramble=False, we don't really need all the separate
        # rngs, but I'm not going to add a special code path right now.)
        rngs = _rng_spawn(qrng.rng, n_independent)
        qrng_class = qrng.__class__
        kwargs = dict(d=1, scramble=qrng.scramble, optimization=qrng._optimization)
        if isinstance(qrng, qmc.Sobol):
            kwargs['bits'] = qrng.bits

        # Draw uniform low-discrepancy sequences scrambled with each RNG
        uniforms = []
        for rng in rngs:
            qrng = qrng_class(seed=rng, **kwargs)
            uniform = qrng.random(n_low_discrepancy)
            uniform = uniform.reshape(n_low_discrepancy if sample_shape else ())[()]
            uniforms.append(uniform)

        # Reorder the axes and ensure that the shape is correct
        uniform = np.moveaxis(np.stack(uniforms), -1, 0) if uniforms else np.asarray([])
        return uniform.reshape(full_shape)

    ### Moments
    # The `moment` method accepts two positional arguments - the order and kind
    # (raw, central, or standard) of the moment - and a keyword option:
    # method - a string that indicates which method should be used to compute
    #          the quantity (e.g. a formula or numerical integration).
    # Like the distribution properties, input/output validation is provided by
    # the `_set_invalid_nan_property` decorator.
    #
    # Unlike most public methods above, `moment` dispatches to one of three
    # private methods - one for each 'kind'. Like most *public* methods above,
    # each of these private methods calls a private "dispatch" method that
    # determines which "method" (strategy for calculating the desired quantity)
    # to use. Also, each dispatch method can designate the responsibility
    # computing the moment to one of several "implementation" methods.
    # Unlike the dispatch methods above, however, the `@_dispatch` decorator
    # is not used, and both logic and method calls are included in the function
    # itself.
    # Instead of determining which method will be used based solely on the
    # implementation methods available and calling only the corresponding
    # implementation method, *all* the implementation methods are called
    # in sequence until one returns the desired information. When an
    # implementation methods cannot provide the requested information, it
    # returns the object None (which is distinct from arrays with NaNs or infs,
    # which are valid values of moments).
    # The reason for this approach is that although formulae for the first
    # few moments of a distribution may be found, general formulae that work
    # for all orders are not always easy to find. This approach allows the
    # developer to write "formula" implementation functions that return the
    # desired moment when it is available and None otherwise.
    #
    # Note that the first implementation method called is a cache. This is
    # important because lower-order moments are often needed to compute
    # higher moments from formulae, so we eliminate redundant calculations
    # when moments of several orders are needed.

    @cached_property
    def _moment_methods(self):
        return {'cache', 'formula', 'transform',
                'normalize', 'general', 'quadrature'}

    @property
    def _zero(self):
        return self._constants()[0]

    @property
    def _one(self):
        return self._constants()[1]

    def _constants(self):
        if self._constant_cache is not None:
            return self._constant_cache

        constants = self._preserve_type([0, 1])

        if self.cache_policy != _NO_CACHE:
            self._constant_cache = constants

        return constants

    @_set_invalid_nan_property
    def moment(self, order=1, kind='raw', *, method=None):
        kinds = {'raw': self._moment_raw,
                 'central': self._moment_central,
                 'standardized': self._moment_standardized}
        order = self._validate_order_kind(order, kind, kinds)
        moment_kind = kinds[kind]
        return moment_kind(order, method=method)

    def _moment_raw(self, order=1, *, method=None):
        """Raw distribution moment about the origin."""
        # Consider exposing the point about which moments are taken as an
        # option. This is easy to support, since `_moment_transform_center`
        # does all the work.
        methods = self._moment_methods if method is None else {method}
        return self._moment_raw_dispatch(order, methods=methods, **self._parameters)

    def _moment_raw_dispatch(self, order, *, methods, **params):
        moment = None

        if 'cache' in methods:
            moment = self._moment_raw_cache.get(order, None)

        if moment is None and 'formula' in methods:
            moment = self._moment_raw_formula(order, **params)

        if moment is None and 'transform' in methods and order > 1:
            moment = self._moment_raw_transform(order, **params)

        if moment is None and 'general' in methods:
            moment = self._moment_raw_general(order, **params)

        if moment is None and 'quadrature' in methods:
            moment = self._moment_from_pxf(order, center=self._zero, **params)

        if moment is None and 'quadrature_icdf' in methods:
            moment = self._moment_integrate_icdf(order, center=self._zero, **params)

        if moment is not None and self.cache_policy != _NO_CACHE:
            self._moment_raw_cache[order] = moment

        return moment

    def _moment_raw_formula(self, order, **params):
        return None

    def _moment_raw_transform(self, order, **params):
        central_moments = []
        for i in range(int(order) + 1):
            methods = {'cache', 'formula', 'normalize', 'general'}
            moment_i = self._moment_central_dispatch(order=i, methods=methods, **params)
            if moment_i is None:
                return None
            central_moments.append(moment_i)

        # Doesn't make sense to get the mean by "transform", since that's
        # how we got here. Questionable whether 'quadrature' should be here.
        mean_methods = {'cache', 'formula', 'quadrature'}
        mean = self._moment_raw_dispatch(self._one, methods=mean_methods, **params)
        if mean is None:
            return None

        moment = self._moment_transform_center(order, central_moments, mean, self._zero)
        return moment

    def _moment_raw_general(self, order, **params):
        # This is the only general formula for a raw moment of a probability
        # distribution
        return self._one if order == 0 else None

    def _moment_central(self, order=1, *, method=None):
        """Distribution moment about the mean."""
        methods = self._moment_methods if method is None else {method}
        return self._moment_central_dispatch(order, methods=methods, **self._parameters)

    def _moment_central_dispatch(self, order, *, methods, **params):
        moment = None

        if 'cache' in methods:
            moment = self._moment_central_cache.get(order, None)

        if moment is None and 'formula' in methods:
            moment = self._moment_central_formula(order, **params)

        if moment is None and 'transform' in methods:
            moment = self._moment_central_transform(order, **params)

        if moment is None and 'normalize' in methods and order > 2:
            moment = self._moment_central_normalize(order, **params)

        if moment is None and 'general' in methods:
            moment = self._moment_central_general(order, **params)

        if moment is None and 'quadrature' in methods:
            mean = self._moment_raw_dispatch(self._one, **params,
                                             methods=self._moment_methods)
            moment = self._moment_from_pxf(order, center=mean, **params)

        if moment is None and 'quadrature_icdf' in methods:
            mean = self._moment_raw_dispatch(self._one, **params,
                                             methods=self._moment_methods)
            moment = self._moment_integrate_icdf(order, center=mean, **params)

        if moment is not None and self.cache_policy != _NO_CACHE:
            self._moment_central_cache[order] = moment

        return moment

    def _moment_central_formula(self, order, **params):
        return None

    def _moment_central_transform(self, order, **params):

        raw_moments = []
        for i in range(int(order) + 1):
            methods = {'cache', 'formula', 'general'}
            moment_i = self._moment_raw_dispatch(order=i, methods=methods, **params)
            if moment_i is None:
                return None
            raw_moments.append(moment_i)

        mean_methods = self._moment_methods
        mean = self._moment_raw_dispatch(self._one, methods=mean_methods, **params)

        moment = self._moment_transform_center(order, raw_moments, self._zero, mean)
        return moment

    def _moment_central_normalize(self, order, **params):
        methods = {'cache', 'formula', 'general'}
        standard_moment = self._moment_standardized_dispatch(order, **params,
                                                             methods=methods)
        if standard_moment is None:
            return None
        var = self._moment_central_dispatch(2, methods=self._moment_methods, **params)
        return standard_moment*var**(order/2)

    def _moment_central_general(self, order, **params):
        general_central_moments = {0: self._one, 1: self._zero}
        return general_central_moments.get(order, None)

    def _moment_standardized(self, order=1, *, method=None):
        """Standardized distribution moment."""
        methods = self._moment_methods if method is None else {method}
        return self._moment_standardized_dispatch(order, methods=methods,
                                                  **self._parameters)

    def _moment_standardized_dispatch(self, order, *, methods, **params):
        moment = None

        if 'cache' in methods:
            moment = self._moment_standardized_cache.get(order, None)

        if moment is None and 'formula' in methods:
            moment = self._moment_standardized_formula(order, **params)

        if moment is None and 'normalize' in methods:
            moment = self._moment_standardized_normalize(order, False, **params)

        if moment is None and 'general' in methods:
            moment = self._moment_standardized_general(order, **params)

        if moment is None and 'normalize' in methods:
            moment = self._moment_standardized_normalize(order, True, **params)

        if moment is not None and self.cache_policy != _NO_CACHE:
            self._moment_standardized_cache[order] = moment

        return moment

    def _moment_standardized_formula(self, order, **params):
        return None

    def _moment_standardized_normalize(self, order, use_quadrature, **params):
        methods = ({'quadrature'} if use_quadrature
                   else {'cache', 'formula', 'transform'})
        central_moment = self._moment_central_dispatch(order, **params,
                                                       methods=methods)
        if central_moment is None:
            return None
        var = self._moment_central_dispatch(2, methods=self._moment_methods,
                                            **params)
        return central_moment/var**(order/2)

    def _moment_standardized_general(self, order, **params):
        general_standard_moments = {0: self._one, 1: self._zero, 2: self._one}
        return general_standard_moments.get(order, None)

    def _moment_from_pxf(self, order, center, **params):
        def integrand(x, order, center, **params):
            pxf = self._pxf_dispatch(x, **params)
            return pxf*(x-center)**order
        return self._quadrature(integrand, args=(order, center), params=params)

    def _moment_integrate_icdf(self, order, center, **params):
        def integrand(x, order, center, **params):
            x = self._icdf_dispatch(x, **params)
            return (x-center)**order
        return self._quadrature(integrand, limits=(0., 1.),
                                args=(order, center), params=params)

    def _moment_transform_center(self, order, moment_as, a, b):
        a, b, *moment_as = np.broadcast_arrays(a, b, *moment_as)
        n = order
        i = np.arange(n+1).reshape([-1]+[1]*a.ndim)  # orthogonal to other axes
        i = self._preserve_type(i)
        n_choose_i = special.binom(n, i)
        with np.errstate(invalid='ignore'):  # can happen with infinite moment
            moment_b = np.sum(n_choose_i*moment_as*(a-b)**(n-i), axis=0)
        return moment_b

    def _logmoment(self, order=1, *, logcenter=None, standardized=False):
        # make this private until it is worked into moment
        if logcenter is None or standardized is True:
            logmean = self._logmoment_quad(self._one, -np.inf, **self._parameters)
        else:
            logmean = None

        logcenter = logmean if logcenter is None else logcenter
        res = self._logmoment_quad(order, logcenter, **self._parameters)
        if standardized:
            logvar = self._logmoment_quad(2, logmean, **self._parameters)
            res = res - logvar * (order/2)
        return res

    def _logmoment_quad(self, order, logcenter, **params):
        def logintegrand(x, order, logcenter, **params):
            logpdf = self._logpxf_dispatch(x, **params)
            return logpdf + order * _logexpxmexpy(np.log(x + 0j), logcenter)
            ## if logx == logcenter, `_logexpxmexpy` returns (-inf + 0j)
            ## multiplying by order produces (-inf + nan j) - bad
            ## We're skipping logmoment tests, so we might don't need to fix
            ## now, but if we ever do use run them, this might help:
            # logx = np.log(x+0j)
            # out = np.asarray(logpdf + order*_logexpxmexpy(logx, logcenter))
            # i = (logx == logcenter)
            # out[i] = logpdf[i]
            # return out
        return self._quadrature(logintegrand, args=(order, logcenter),
                                params=params, log=True)

    ### Convenience

    def plot(self, x='x', y=None, *, t=None, ax=None):
        r"""Plot a function of the distribution.

        Convenience function for quick visualization of the distribution
        underlying the random variable.

        Parameters
        ----------
        x, y : str, optional
            String indicating the quantities to be used as the abscissa and
            ordinate (horizontal and vertical coordinates), respectively.
            Defaults are ``'x'`` (the domain of the random variable) and either
            ``'pdf'`` (the probability density function) (continuous) or
            ``'pdf'`` (the probability density function) (discrete).
            Valid values are:
            'x', 'pdf', 'pmf', 'cdf', 'ccdf', 'icdf', 'iccdf', 'logpdf', 'logpmf',
            'logcdf', 'logccdf', 'ilogcdf', 'ilogccdf'.
        t : 3-tuple of (str, float, float), optional
            Tuple indicating the limits within which the quantities are plotted.
            The default is ``('cdf', 0.0005, 0.9995)`` if the domain is infinite,
            indicating that the central 99.9% of the distribution is to be shown;
            otherwise, endpoints of the support are used where they are finite.
            Valid values are:
            'x', 'cdf', 'ccdf', 'icdf', 'iccdf', 'logcdf', 'logccdf',
            'ilogcdf', 'ilogccdf'.
        ax : `matplotlib.axes`, optional
            Axes on which to generate the plot. If not provided, use the
            current axes.

        Returns
        -------
        ax : `matplotlib.axes`
            Axes on which the plot was generated.
            The plot can be customized by manipulating this object.

        Examples
        --------
        Instantiate a distribution with the desired parameters:

        >>> import numpy as np
        >>> import matplotlib.pyplot as plt
        >>> from scipy import stats
        >>> X = stats.Normal(mu=1., sigma=2.)

        Plot the PDF over the central 99.9% of the distribution.
        Compare against a histogram of a random sample.

        >>> ax = X.plot()
        >>> sample = X.sample(10000)
        >>> ax.hist(sample, density=True, bins=50, alpha=0.5)
        >>> plt.show()

        Plot ``logpdf(x)`` as a function of ``x`` in the left tail,
        where the log of the CDF is between -10 and ``np.log(0.5)``.

        >>> X.plot('x', 'logpdf', t=('logcdf', -10, np.log(0.5)))
        >>> plt.show()

        Plot the PDF of the normal distribution as a function of the
        CDF for various values of the scale parameter.

        >>> X = stats.Normal(mu=0., sigma=[0.5, 1., 2])
        >>> X.plot('cdf', 'pdf')
        >>> plt.show()

        """

        # Strategy: given t limits, get quantile limits. Form grid of
        # quantiles, compute requested x and y at quantiles, and plot.
        # Currently, the grid of quantiles is always linearly spaced.
        # Instead of always computing linearly-spaced quantiles, it
        # would be better to choose:
        # a) quantiles or probabilities
        # b) linearly or logarithmically spaced
        # based on the specified `t`.
        # TODO:
        # - smart spacing of points
        # - when the parameters of the distribution are an array,
        #   use the full range of abscissae for all curves

        discrete = isinstance(self, DiscreteDistribution)
        t_is_quantile = {'x', 'icdf', 'iccdf', 'ilogcdf', 'ilogccdf'}
        t_is_probability = {'cdf', 'ccdf', 'logcdf', 'logccdf'}
        valid_t = t_is_quantile.union(t_is_probability)
        valid_xy =  valid_t.union({'pdf', 'logpdf', 'pmf', 'logpmf'})
        y_default = 'pmf' if discrete else 'pdf'
        y = y_default if y is None else y

        ndim = self._ndim
        x_name, y_name = x, y
        t_name = 'cdf' if t is None else t[0]

        a, b = self.support()
        tliml_default = 0 if np.all(np.isfinite(a)) else 0.0005
        tliml = tliml_default if t is None else t[1]
        tlimr_default = 1 if np.all(np.isfinite(b)) else 0.9995
        tlimr = tlimr_default if t is None else t[2]
        tlim = np.asarray([tliml, tlimr])
        tlim = tlim[:, np.newaxis] if ndim else tlim

        # pdf/logpdf are not valid for `t` because we can't easily invert them
        message = (f'Argument `t` of `{self.__class__.__name__}.plot` "'
                   f'must be one of {valid_t}')
        if t_name not in valid_t:
            raise ValueError(message)

        message = (f'Argument `x` of `{self.__class__.__name__}.plot` "'
                   f'must be one of {valid_xy}')
        if x_name not in valid_xy:
            raise ValueError(message)

        message = (f'Argument `y` of `{self.__class__.__name__}.plot` "'
                   f'must be one of {valid_xy}')
        if y_name not in valid_xy:
            raise ValueError(message)

        # This could just be a warning
        message = (f'`{self.__class__.__name__}.plot` was called on a random '
                   'variable with at least one invalid shape parameters. When '
                   'a parameter is invalid, no plot can be shown.')
        if self._any_invalid:
            raise ValueError(message)

        # We could automatically ravel, but do we want to? For now, raise.
        message = ("To use `plot`, distribution parameters must be "
                   "scalars or arrays with one or fewer dimensions.")
        if ndim > 1:
            raise ValueError(message)

        try:
            import matplotlib.pyplot as plt  # noqa: F401, E402
        except ModuleNotFoundError as exc:
            message = ("`matplotlib` must be installed to use "
                       f"`{self.__class__.__name__}.plot`.")
            raise ModuleNotFoundError(message) from exc
        ax = plt.gca() if ax is None else ax

        # get quantile limits given t limits
        qlim = tlim if t_name in t_is_quantile else getattr(self, 'i'+t_name)(tlim)

        message = (f"`{self.__class__.__name__}.plot` received invalid input for `t`: "
                   f"calling {'i'+t_name}({tlim}) produced {qlim}.")
        if not np.all(np.isfinite(qlim)):
            raise ValueError(message)

        # form quantile grid
        if discrete and x_name in t_is_quantile:
            # should probably aggregate for large ranges
            q = np.arange(np.min(qlim[0]), np.max(qlim[1]) + 1)
            q = q[:, np.newaxis] if ndim else q
        else:
            grid = np.linspace(0, 1, 300)
            grid = grid[:, np.newaxis] if ndim else grid
            q = qlim[0] + (qlim[1] - qlim[0]) * grid
            q = np.round(q) if discrete else q

        # compute requested x and y at quantile grid
        x = q if x_name in t_is_quantile else getattr(self, x_name)(q)
        y = q if y_name in t_is_quantile else getattr(self, y_name)(q)

        # make plot
        x, y = np.broadcast_arrays(x.T, np.atleast_2d(y.T))
        for xi, yi in zip(x, y):  # plot is vectorized, but bar/step don't seem to be
            if discrete and x_name in t_is_quantile and y_name == 'pmf':
                # should this just be a step plot, too?
                ax.bar(xi, yi, alpha=np.sqrt(1/y.shape[0]))  # alpha heuristic
            elif discrete and x_name in t_is_quantile:
                values = yi
                edges = np.concatenate((xi, [xi[-1]+1]))
                ax.stairs(values, edges, baseline=None)
            else:
                ax.plot(xi, yi)
        ax.set_xlabel(f"${x_name}$")
        ax.set_ylabel(f"${y_name}$")
        ax.set_title(str(self))

        # only need a legend if distribution has parameters
        if len(self._parameters):
            label = []
            parameters = self._parameterization.parameters
            param_names = list(parameters)
            param_arrays = [np.atleast_1d(self._parameters[pname])
                            for pname in param_names]
            for param_vals in zip(*param_arrays):
                assignments = [f"${parameters[name].symbol}$ = {val:.4g}"
                               for name, val in zip(param_names, param_vals)]
                label.append(", ".join(assignments))
            ax.legend(label)

        return ax


    ### Fitting
    # All methods above treat the distribution parameters as fixed, and the
    # variable argument may be a quantile or probability. The fitting functions
    # are fundamentally different because the quantiles (often observations)
    # are considered to be fixed, and the distribution parameters are the
    # variables. In a sense, they are like an inverse of the sampling
    # functions.
    #
    # At first glance, it would seem ideal for `fit` to be a classmethod,
    # called like `LogUniform.fit(sample=sample)`.
    # I tried this. I insisted on it for a while. But if `fit` is a
    # classmethod, it cannot call instance methods. If we want to support MLE,
    # MPS, MoM, MoLM, then we end up with most of the distribution functions
    # above needing to be classmethods, too. All state information, such as
    # tolerances and the underlying distribution of `ShiftedScaledDistribution`
    # and `OrderStatisticDistribution`, would need to be passed into all
    # methods. And I'm not really sure how we would call `fit` as a
    # classmethod of a transformed distribution - maybe
    # ShiftedScaledDistribution.fit would accept the class of the
    # shifted/scaled distribution as an argument?
    #
    # In any case, it was a conscious decision for the infrastructure to
    # treat the parameters as "fixed" and the quantile/percentile arguments
    # as "variable". There are a lot of advantages to this structure, and I
    # don't think the fact that a few methods reverse the fixed and variable
    # quantities should make us question that choice. It can still accomodate
    # these methods reasonably efficiently.


class ContinuousDistribution(UnivariateDistribution):
    def _overrides(self, method_name):
        if method_name in {'_logpmf_formula', '_pmf_formula'}:
            return True
        return super()._overrides(method_name)

    def _pmf_formula(self, x, **params):
        return np.zeros_like(x)

    def _logpmf_formula(self, x, **params):
        return np.full_like(x, -np.inf)

    def _pxf_dispatch(self, x, *, method=None, **params):
        return self._pdf_dispatch(x, method=method, **params)

    def _logpxf_dispatch(self, x, *, method=None, **params):
        return self._logpdf_dispatch(x, method=method, **params)

    def _solve_bounded_continuous(self, func, p, params, xatol=None):
        return self._solve_bounded(func, p, params=params, xatol=xatol).x


class DiscreteDistribution(UnivariateDistribution):
    def _overrides(self, method_name):
        if method_name in {'_logpdf_formula', '_pdf_formula'}:
            return True
        return super()._overrides(method_name)

    def _logpdf_formula(self, x, **params):
        if params:
            p = next(iter(params.values()))
            nan_result = np.isnan(x) | np.isnan(p)
        else:
            nan_result = np.isnan(x)
        return np.where(nan_result, np.nan, np.inf)

    def _pdf_formula(self, x, **params):
        if params:
            p = next(iter(params.values()))
            nan_result = np.isnan(x) | np.isnan(p)
        else:
            nan_result = np.isnan(x)
        return np.where(nan_result, np.nan, np.inf)

    def _pxf_dispatch(self, x, *, method=None, **params):
        return self._pmf_dispatch(x, method=method, **params)

    def _logpxf_dispatch(self, x, *, method=None, **params):
        return self._logpmf_dispatch(x, method=method, **params)

    def _cdf_quadrature(self, x, **params):
        return super()._cdf_quadrature(np.floor(x), **params)

    def _logcdf_quadrature(self, x, **params):
        return super()._logcdf_quadrature(np.floor(x), **params)

    def _ccdf_quadrature(self, x, **params):
        return super()._ccdf_quadrature(np.floor(x + 1), **params)

    def _logccdf_quadrature(self, x, **params):
        return super()._logccdf_quadrature(np.floor(x + 1), **params)

    def _cdf2(self, x, y, *, method):
        raise NotImplementedError(
            "Two argument cdf functions are currently only supported for "
            "continuous distributions.")

    def _ccdf2(self, x, y, *, method):
        raise NotImplementedError(
            "Two argument cdf functions are currently only supported for "
            "continuous distributions.")

    def _logcdf2(self, x, y, *, method):
        raise NotImplementedError(
            "Two argument cdf functions are currently only supported for "
            "continuous distributions.")

    def _logccdf2(self, x, y, *, method):
        raise NotImplementedError(
            "Two argument cdf functions are currently only supported for "
            "continuous distributions.")

    def _solve_bounded_discrete(self, func, p, params, comp):
        res = self._solve_bounded(func, p, params=params, xatol=0.9)
        x = np.asarray(np.floor(res.xr))

        # if _chandrupatla finds exact inverse, the bracket may not have been reduced
        # enough for `np.floor(res.x)` to be the appropriate value of `x`.
        mask = res.fun == 0
        x[mask] = np.floor(res.x[mask])

        xmin, xmax = self._support(**params)
        p, xmin, xmax = np.broadcast_arrays(p, xmin, xmax)
        mask = comp(func(xmin, **params), p)
        x[mask] = xmin[mask]

        return x

    def _base_discrete_inversion(self, p, func, comp, /, **params):
        # For discrete distributions, icdf(p) is defined as the minimum n
        # such that cdf(n) >= p. iccdf(p) is defined as the minimum n such
        # that ccdf(n) <= p, or equivalently as iccdf(p) = icdf(1 - p).

        # First try to find where cdf(x) == p for the continuous extension of the
        # cdf. res.xl and res.xr will be a bracket for this root. The parameter
        # xatol in solve_bounded controls the bracket width. We thus know that
        # know cdf(res.xr) >= p, cdf(res.xl) <= p, and |res.xr - res.xl| <= 0.9.
        # This means the minimum integer n such that cdf(n) >= p is either floor(x)
        # or floor(x) + 1.
        x = self._solve_bounded_discrete(func, p, params=params, comp=comp)
        # comp should be <= for ccdf, >= for cdf.
        f = func(x, **params)
        res = np.where(comp(f, p), x, x + 1.0)
        # xr is a bracket endpoint, and will usually be a finite value even when
        # the computed result should be nan. We need to explicitly handle this
        # case.
        res[np.isnan(f) | np.isnan(p)] = np.nan
        return res[()]

    def _icdf_inversion(self, x, **params):
        return self._base_discrete_inversion(x, self._cdf_dispatch,
                                             np.greater_equal, **params)

    def _ilogcdf_inversion(self, x, **params):
        return self._base_discrete_inversion(x, self._logcdf_dispatch,
                                             np.greater_equal, **params)

    def _iccdf_inversion(self, x, **params):
        return self._base_discrete_inversion(x, self._ccdf_dispatch,
                                             np.less_equal, **params)

    def _ilogccdf_inversion(self, x, **params):
        return self._base_discrete_inversion(x, self._logccdf_dispatch,
                                             np.less_equal, **params)

    def _mode_optimization(self, **params):
        # If `x` is the true mode of a unimodal continuous function, we can find
        # the mode among integers by rounding in each direction and checking
        # which is better. If the difference between `x` and the nearest integer
        # is less than `xatol`, the computed value of `x` may end up on the wrong
        # side of the nearest integer. Setting `xatol=0.5` guarantees that at most
        # three integers need to be checked, the two nearest integers, ``floor(x)``
        # and ``round(x)`` and the nearest integer other than these.
        x = super()._mode_optimization(xatol=0.5, **params)
        low, high = self.support()
        xl, xr = np.floor(x), np.ceil(x)
        nearest = np.round(x)
        # Clip to stay within support. There will be redundant calculation
        # when clipping since `xo` will be one of `xl` or `xr`, but let's
        # keep the implementation simple for now.
        xo = np.clip(nearest + np.copysign(1, nearest - x), low, high)
        x = np.stack([xl, xo, xr])
        idx = np.argmax(self._pmf_dispatch(x, **params), axis=0)
        return np.choose(idx, [xl, xo, xr])

    def _logentropy_quadrature(self, **params):
        def logintegrand(x, **params):
            logpmf = self._logpmf_dispatch(x, **params)
            # Entropy summand is -pmf*log(pmf), so log-entropy summand is
            # logpmf + log(logpmf) + pi*j. But pmf is always between 0 and 1,
            # so logpmf is always negative, and so log(logpmf) = log(-logpmf) + pi*j.
            # The two imaginary components "cancel" each other out (which we would
            # expect because each term of the entropy summand is positive).
            return np.where(np.isfinite(logpmf), logpmf + np.log(-logpmf), -np.inf)
        return self._quadrature(logintegrand, params=params, log=True)


# Special case the names of some new-style distributions in `make_distribution`
_distribution_names = {
    # Continuous
    'argus': 'ARGUS',
    'betaprime': 'BetaPrime',
    'chi2': 'ChiSquared',
    'crystalball': 'CrystalBall',
    'dgamma': 'DoubleGamma',
    'dweibull': 'DoubleWeibull',
    'expon': 'Exponential',
    'exponnorm': 'ExponentiallyModifiedNormal',
    'exponweib': 'ExponentialWeibull',
    'exponpow': 'ExponentialPower',
    'fatiguelife': 'FatigueLife',
    'foldcauchy': 'FoldedCauchy',
    'foldnorm': 'FoldedNormal',
    'genlogistic': 'GeneralizedLogistic',
    'gennorm': 'GeneralizedNormal',
    'genpareto': 'GeneralizedPareto',
    'genexpon': 'GeneralizedExponential',
    'genextreme': 'GeneralizedExtremeValue',
    'gausshyper': 'GaussHypergeometric',
    'gengamma': 'GeneralizedGamma',
    'genhalflogistic': 'GeneralizedHalfLogistic',
    'geninvgauss': 'GeneralizedInverseGaussian',
    'gumbel_r': 'Gumbel',
    'gumbel_l': 'ReflectedGumbel',
    'halfcauchy': 'HalfCauchy',
    'halflogistic': 'HalfLogistic',
    'halfnorm': 'HalfNormal',
    'halfgennorm': 'HalfGeneralizedNormal',
    'hypsecant': 'HyperbolicSecant',
    'invgamma': 'InverseGammma',
    'invgauss': 'InverseGaussian',
    'invweibull': 'InverseWeibull',
    'irwinhall': 'IrwinHall',
    'jf_skew_t': 'JonesFaddySkewT',
    'johnsonsb': 'JohnsonSB',
    'johnsonsu': 'JohnsonSU',
    'ksone': 'KSOneSided',
    'kstwo': 'KSTwoSided',
    'kstwobign': 'KSTwoSidedAsymptotic',
    'laplace_asymmetric': 'LaplaceAsymmetric',
    'levy_l': 'LevyLeft',
    'levy_stable': 'LevyStable',
    'loggamma': 'ExpGamma',  # really the Exponential Gamma Distribution
    'loglaplace': 'LogLaplace',
    'lognorm': 'LogNormal',
    'loguniform': 'LogUniform',
    'ncx2': 'NoncentralChiSquared',
    'nct': 'NoncentralT',
    'norm': 'Normal',
    'norminvgauss': 'NormalInverseGaussian',
    'powerlaw': 'PowerLaw',
    'powernorm': 'PowerNormal',
    'rdist': 'R',
    'rel_breitwigner': 'RelativisticBreitWigner',
    'recipinvgauss': 'ReciprocalInverseGaussian',
    'reciprocal': 'LogUniform',
    'semicircular': 'SemiCircular',
    'skewcauchy': 'SkewCauchy',
    'skewnorm': 'SkewNormal',
    'studentized_range': 'StudentizedRange',
    't': 'StudentT',
    'trapezoid': 'Trapezoidal',
    'triang': 'Triangular',
    'truncexpon': 'TruncatedExponential',
    'truncnorm': 'TruncatedNormal',
    'truncpareto': 'TruncatedPareto',
    'truncweibull_min': 'TruncatedWeibull',
    'tukeylambda': 'TukeyLambda',
    'vonmises_line': 'VonMisesLine',
    'weibull_min': 'Weibull',
    'weibull_max': 'ReflectedWeibull',
    'wrapcauchy': 'WrappedCauchyLine',
    # Discrete
    'betabinom': 'BetaBinomial',
    'betanbinom': 'BetaNegativeBinomial',
    'dlaplace': 'LaplaceDiscrete',
    'geom': 'Geometric',
    'hypergeom': 'Hypergeometric',
    'logser': 'LogarithmicSeries',
    'nbinom': 'NegativeBinomial',
    'nchypergeom_fisher': 'NoncentralHypergeometricFisher',
    'nchypergeom_wallenius': 'NoncentralHypergeometricWallenius',
    'nhypergeom': 'NegativeHypergeometric',
    'poisson_binom': 'PoissonBinomial',
    'randint': 'UniformDiscrete',
    'yulesimon': 'YuleSimon',
    'zipf': 'Zeta',
}


# beta, genextreme, gengamma, t, tukeylambda need work for 1D arrays
def make_distribution(dist):
    """Generate a `UnivariateDistribution` class from a compatible object

    The argument may be an instance of `rv_continuous` or an instance of
    another class that satisfies the interface described below.

    The returned value is a `ContinuousDistribution` subclass if the input is an
    instance of `rv_continuous` or a `DiscreteDistribution` subclass if the input
    is an instance of `rv_discrete`. Like any subclass of `UnivariateDistribution`,
    it must be instantiated (i.e. by passing all shape parameters as keyword
    arguments) before use. Once instantiated, the resulting object will have the
    same interface as any other instance of `UnivariateDistribution`; e.g.,
    `scipy.stats.Normal`, `scipy.stats.Binomial`.

    .. note::

        `make_distribution` does not work perfectly with all instances of
        `rv_continuous`. Known failures include `levy_stable`, `vonmises`,
        `hypergeom`, 'nchypergeom_fisher', 'nchypergeom_wallenius', and
        `poisson_binom`. Some methods of some distributions will not support
        array shape parameters.

    Parameters
    ----------
    dist : `rv_continuous`
        Instance of `rv_continuous`, `rv_discrete`, or an instance of any class with
        the following attributes:

        __make_distribution_version__ : str
            A string containing the version number of SciPy in which this interface
            is defined. The preferred interface may change in future SciPy versions,
            in which case support for an old interface version may be deprecated
            and eventually removed.
        parameters : dict or tuple
            If a dictionary, each key is the name of a parameter,
            and the corresponding value is either a dictionary or tuple.
            If the value is a dictionary, it may have the following items, with default
            values used for entries which aren't present.

            endpoints : tuple, default: (-inf, inf)
                A tuple defining the lower and upper endpoints of the domain of the
                parameter; allowable values are floats, the name (string) of another
                parameter, or a callable taking parameters as keyword only
                arguments and returning the numerical value of an endpoint for
                given parameter values.

            inclusive : tuple of bool, default: (False, False)
                A tuple specifying whether the endpoints are included within the domain
                of the parameter.

            typical : tuple, default: ``endpoints``
                Defining endpoints of a typical range of values of a parameter. Can be
                used for sampling parameter values for testing. Behaves like the
                ``endpoints`` tuple above, and should define a subinterval of the
                domain given by ``endpoints``.

            A tuple value ``(a, b)`` associated to a key in the ``parameters``
            dictionary is equivalent to ``{endpoints: (a, b)}``.

            Custom distributions with multiple parameterizations can be defined by
            having the ``parameters`` attribute be a tuple of dictionaries with
            the structure described above. In this case, ``dist``\'s class must also
            define a method ``process_parameters`` to map between the different
            parameterizations. It must take all parameters from all parameterizations
            as optional keyword arguments and return a dictionary mapping parameters to
            values, filling in values from other parameterizations using values from
            the supplied parameterization. See example.

        support : dict or tuple
            A dictionary describing the support of the distribution or a tuple
            describing the endpoints of the support. This behaves identically to
            the values of the parameters dict described above, except that the key
            ``typical`` is ignored.

        The class **must** also define a ``pdf`` method and **may** define methods
        ``logentropy``, ``entropy``, ``median``, ``mode``, ``logpdf``,
        ``logcdf``, ``cdf``, ``logccdf``, ``ccdf``,
        ``ilogcdf``, ``icdf``, ``ilogccdf``, ``iccdf``,
        ``moment``, and ``sample``.
        If defined, these methods must accept the parameters of the distribution as
        keyword arguments and also accept any positional-only arguments accepted by
        the corresponding method of `ContinuousDistribution`.
        When multiple parameterizations are defined, these methods must accept
        all parameters from all parameterizations. The ``moment`` method
        must accept the ``order`` and ``kind`` arguments by position or keyword, but
        may return ``None`` if a formula is not available for the arguments; in this
        case, the infrastructure will fall back to a default implementation. The
        ``sample`` method must accept ``shape`` by position or keyword, but contrary
        to the public method of the same name, the argument it receives will be the
        *full* shape of the output array - that is, the shape passed to the public
        method prepended to the broadcasted shape of random variable parameters.

    Returns
    -------
    CustomDistribution : `UnivariateDistribution`
        A subclass of `UnivariateDistribution` corresponding with `dist`. The
        initializer requires all shape parameters to be passed as keyword arguments
        (using the same names as the instance of `rv_continuous`/`rv_discrete`).

    Notes
    -----
    The documentation of `UnivariateDistribution` is not rendered. See below for
    an example of how to instantiate the class (i.e. pass all shape parameters of
    `dist` to the initializer as keyword arguments). Documentation of all methods
    is identical to that of `scipy.stats.Normal`. Use ``help`` on the returned
    class or its methods for more information.

    Examples
    --------
    >>> import numpy as np
    >>> import matplotlib.pyplot as plt
    >>> from scipy import stats
    >>> from scipy import special

    Create a `ContinuousDistribution` from `scipy.stats.loguniform`.

    >>> LogUniform = stats.make_distribution(stats.loguniform)
    >>> X = LogUniform(a=1.0, b=3.0)
    >>> np.isclose((X + 0.25).median(), stats.loguniform.ppf(0.5, 1, 3, loc=0.25))
    np.True_
    >>> X.plot()
    >>> sample = X.sample(10000, rng=np.random.default_rng())
    >>> plt.hist(sample, density=True, bins=30)
    >>> plt.legend(('pdf', 'histogram'))
    >>> plt.show()

    Create a custom distribution.

    >>> class MyLogUniform:
    ...     @property
    ...     def __make_distribution_version__(self):
    ...         return "1.16.0"
    ...
    ...     @property
    ...     def parameters(self):
    ...         return {'a': {'endpoints': (0, np.inf),
    ...                       'inclusive': (False, False)},
    ...                 'b': {'endpoints': ('a', np.inf),
    ...                       'inclusive': (False, False)}}
    ...
    ...     @property
    ...     def support(self):
    ...         return {'endpoints': ('a', 'b'), 'inclusive': (True, True)}
    ...
    ...     def pdf(self, x, a, b):
    ...         return 1 / (x * (np.log(b)- np.log(a)))
    >>>
    >>> MyLogUniform = stats.make_distribution(MyLogUniform())
    >>> Y = MyLogUniform(a=1.0, b=3.0)
    >>> np.isclose(Y.cdf(2.), X.cdf(2.))
    np.True_

    Create a custom distribution with variable support.

    >>> class MyUniformCube:
    ...     @property
    ...     def __make_distribution_version__(self):
    ...         return "1.16.0"
    ...
    ...     @property
    ...     def parameters(self):
    ...         return {"a": (-np.inf, np.inf),
    ...                 "b": {'endpoints':('a', np.inf), 'inclusive':(True, False)}}
    ...
    ...     @property
    ...     def support(self):
    ...         def left(*, a, b):
    ...             return a**3
    ...
    ...         def right(*, a, b):
    ...             return b**3
    ...         return (left, right)
    ...
    ...     def pdf(self, x, *, a, b):
    ...         return 1 / (3*(b - a)*np.cbrt(x)**2)
    ...
    ...     def cdf(self, x, *, a, b):
    ...         return (np.cbrt(x) - a) / (b - a)
    >>>
    >>> MyUniformCube = stats.make_distribution(MyUniformCube())
    >>> X = MyUniformCube(a=-2, b=2)
    >>> Y = stats.Uniform(a=-2, b=2)**3
    >>> X.support()
    (-8.0, 8.0)
    >>> np.isclose(X.cdf(2.1), Y.cdf(2.1))
    np.True_

    Create a custom distribution with multiple parameterizations. Here we create a
    custom version of the beta distribution that has an alternative parameterization
    in terms of the mean ``mu`` and a dispersion parameter ``nu``.

    >>> class MyBeta:
    ...     @property
    ...     def __make_distribution_version__(self):
    ...         return "1.16.0"
    ...
    ...     @property
    ...     def parameters(self):
    ...         return ({"a": (0, np.inf), "b": (0, np.inf)},
    ...                 {"mu": (0, 1), "nu": (0, np.inf)})
    ...
    ...     def process_parameters(self, a=None, b=None, mu=None, nu=None):
    ...         if a is not None and b is not None:
    ...             nu = a + b
    ...             mu = a / nu
    ...         else:
    ...             a = mu * nu
    ...             b = nu - a
    ...         return dict(a=a, b=b, mu=mu, nu=nu)
    ...
    ...     @property
    ...     def support(self):
    ...         return {'endpoints': (0, 1)}
    ...
    ...     def pdf(self, x, a, b, mu, nu):
    ...         return special._ufuncs._beta_pdf(x, a, b)
    ...
    ...     def cdf(self, x, a, b, mu, nu):
    ...         return special.betainc(a, b, x)
    >>>
    >>> MyBeta = stats.make_distribution(MyBeta())
    >>> X = MyBeta(a=2.0, b=2.0)
    >>> Y = MyBeta(mu=0.5, nu=4.0)
    >>> np.isclose(X.pdf(0.3), Y.pdf(0.3))
    np.True_

    """
    if dist in {stats.levy_stable, stats.vonmises, stats.hypergeom,
                stats.nchypergeom_fisher, stats.nchypergeom_wallenius,
                stats.poisson_binom}:
        raise NotImplementedError(f"`{dist.name}` is not supported.")

    if isinstance(dist, stats.rv_continuous | stats.rv_discrete):
        return _make_distribution_rv_generic(dist)
    elif getattr(dist, "__make_distribution_version__", "0.0.0") >= "1.16.0":
        return _make_distribution_custom(dist)
    else:
        message = ("The argument must be an instance of `rv_continuous`, "
                   "`rv_discrete`, or an instance of a class with attribute "
                   "`__make_distribution_version__ >= 1.16`.")
        raise ValueError(message)

def _make_distribution_rv_generic(dist):
    parameters = []
    names = []
    support = getattr(dist, '_support', (dist.a, dist.b))
    for shape_info in dist._shape_info():
        domain = _RealInterval(endpoints=shape_info.endpoints,
                             inclusive=shape_info.inclusive)
        param = _RealParameter(shape_info.name, domain=domain)
        parameters.append(param)
        names.append(shape_info.name)

    repr_str = _distribution_names.get(dist.name, dist.name.capitalize())
    if isinstance(dist, stats.rv_continuous):
        old_class, new_class = stats.rv_continuous, ContinuousDistribution
    else:
        old_class, new_class = stats.rv_discrete, DiscreteDistribution

    def _overrides(method_name):
        return (getattr(dist.__class__, method_name, None)
                is not getattr(old_class, method_name, None))

    if _overrides("_get_support"):
        def left(**parameter_values):
            a, _ = dist._get_support(**parameter_values)
            return np.asarray(a)[()]

        def right(**parameter_values):
            _, b = dist._get_support(**parameter_values)
            return np.asarray(b)[()]

        endpoints = (left, right)
    else:
        endpoints = support

    _x_support = _RealInterval(endpoints=endpoints, inclusive=(True, True))
    _x_param = _RealParameter('x', domain=_x_support, typical=(-1, 1))

    class CustomDistribution(new_class):
        _parameterizations = ([_Parameterization(*parameters)] if parameters
                              else [])
        _variable = _x_param

        def __repr__(self):
            s = super().__repr__()
            return s.replace('CustomDistribution', repr_str)

        def __str__(self):
            s = super().__str__()
            return s.replace('CustomDistribution', repr_str)

    def _sample_formula(self, full_shape=(), *, rng=None, **kwargs):
        return dist._rvs(size=full_shape, random_state=rng, **kwargs)

    def _moment_raw_formula(self, order, **kwargs):
        return dist._munp(int(order), **kwargs)

    def _moment_raw_formula_1(self, order, **kwargs):
        if order != 1:
            return None
        return dist._stats(**kwargs)[0]

    def _moment_central_formula(self, order, **kwargs):
        if order != 2:
            return None
        return dist._stats(**kwargs)[1]

    def _moment_standard_formula(self, order, **kwargs):
        if order == 3:
            if dist._stats_has_moments:
                kwargs['moments'] = 's'
            return dist._stats(**kwargs)[int(order - 1)]
        elif order == 4:
            if dist._stats_has_moments:
                kwargs['moments'] = 'k'
            k = dist._stats(**kwargs)[int(order - 1)]
            return k if k is None else k + 3
        else:
            return None

    methods = {'_logpdf': '_logpdf_formula',
               '_pdf': '_pdf_formula',
               '_logpmf': '_logpmf_formula',
               '_pmf': '_pmf_formula',
               '_logcdf': '_logcdf_formula',
               '_cdf': '_cdf_formula',
               '_logsf': '_logccdf_formula',
               '_sf': '_ccdf_formula',
               '_ppf': '_icdf_formula',
               '_isf': '_iccdf_formula',
               '_entropy': '_entropy_formula',
               '_median': '_median_formula'}

    # These are not desirable overrides for the new infrastructure
    skip_override = {'norminvgauss': {'_sf', '_isf'}}

    for old_method, new_method in methods.items():
        if dist.name in skip_override and old_method in skip_override[dist.name]:
            continue
        # If method of old distribution overrides generic implementation...
        method = getattr(dist.__class__, old_method, None)
        super_method = getattr(old_class, old_method, None)
        if method is not super_method:
            # Make it an attribute of the new object with the new name
            setattr(CustomDistribution, new_method, getattr(dist, old_method))

    if _overrides('_munp'):
        CustomDistribution._moment_raw_formula = _moment_raw_formula

    if _overrides('_rvs'):
        CustomDistribution._sample_formula = _sample_formula

    if _overrides('_stats'):
        CustomDistribution._moment_standardized_formula = _moment_standard_formula
        if not _overrides('_munp'):
            CustomDistribution._moment_raw_formula = _moment_raw_formula_1
            CustomDistribution._moment_central_formula = _moment_central_formula

    support_etc = _combine_docs(CustomDistribution, include_examples=False).lstrip()
    docs = [
        f"This class represents `scipy.stats.{dist.name}` as a subclass of "
        f"`{new_class}`.",
        f"The `repr`/`str` of class instances is `{repr_str}`.",
        f"The PDF of the distribution is defined {support_etc}"
    ]
    CustomDistribution.__doc__ = ("\n".join(docs))

    return CustomDistribution


def _get_domain_info(info):
    domain_info = {"endpoints": info} if isinstance(info, tuple) else info
    typical = domain_info.pop("typical", None)
    return domain_info, typical


def _make_distribution_custom(dist):
    dist_parameters = (
        dist.parameters if isinstance(dist.parameters, tuple) else (dist.parameters, )
    )
    parameterizations = []
    for parameterization in dist_parameters:
        # The attribute name ``parameters`` appears reasonable from a user facing
        # perspective, but there is a little tension here with the internal. It's
        # important to keep in mind that the ``parameters`` attribute in a
        # user-created custom distribution specifies ``_parameterizations`` within
        # the infrastructure.
        parameters = []

        for name, info in parameterization.items():
            domain_info, typical = _get_domain_info(info)
            domain = _RealInterval(**domain_info)
            param = _RealParameter(name, domain=domain, typical=typical)
            parameters.append(param)
        parameterizations.append(_Parameterization(*parameters) if parameters else [])

    domain_info, _ = _get_domain_info(dist.support)
    _x_support = _RealInterval(**domain_info)
    _x_param = _RealParameter('x', domain=_x_support)
    repr_str = dist.__class__.__name__

    class CustomDistribution(ContinuousDistribution):
        _parameterizations = parameterizations
        _variable = _x_param

        def __repr__(self):
            s = super().__repr__()
            return s.replace('CustomDistribution', repr_str)

        def __str__(self):
            s = super().__str__()
            return s.replace('CustomDistribution', repr_str)

    methods = {'sample', 'logentropy', 'entropy',
               'median', 'mode', 'logpdf', 'pdf',
               'logcdf2', 'logcdf', 'cdf2', 'cdf',
               'logccdf2', 'logccdf', 'ccdf2', 'ccdf',
               'ilogcdf', 'icdf', 'ilogccdf', 'iccdf'}

    for method in methods:
        if hasattr(dist, method):
            # Make it an attribute of the new object with the new name
            new_method = f"_{method}_formula"
            setattr(CustomDistribution, new_method, getattr(dist, method))

    if hasattr(dist, 'moment'):
        def _moment_raw_formula(self, order, **kwargs):
            return dist.moment(order, kind='raw', **kwargs)

        def _moment_central_formula(self, order, **kwargs):
            return dist.moment(order, kind='central', **kwargs)

        def _moment_standardized_formula(self, order, **kwargs):
            return dist.moment(order, kind='standardized', **kwargs)

        CustomDistribution._moment_raw_formula = _moment_raw_formula
        CustomDistribution._moment_central_formula = _moment_central_formula
        CustomDistribution._moment_standardized_formula = _moment_standardized_formula

    if hasattr(dist, 'process_parameters'):
        setattr(
            CustomDistribution,
            "_process_parameters",
            getattr(dist, "process_parameters")
        )

    support_etc = _combine_docs(CustomDistribution, include_examples=False).lstrip()
    docs = [
        f"This class represents `{repr_str}` as a subclass of "
        "`ContinuousDistribution`.",
        f"The PDF of the distribution is defined {support_etc}"
    ]
    CustomDistribution.__doc__ = ("\n".join(docs))

    return CustomDistribution


# Rough sketch of how we might shift/scale distributions. The purpose of
# making it a separate class is for
# a) simplicity of the ContinuousDistribution class and
# b) avoiding the requirement that every distribution accept loc/scale.
# The simplicity of ContinuousDistribution is important, because there are
# several other distribution transformations to be supported; e.g., truncation,
# wrapping, folding, and doubling. We wouldn't want to cram all of this
# into the `ContinuousDistribution` class. Also, the order of the composition
# matters (e.g. truncate then shift/scale or vice versa). It's easier to
# accommodate different orders if the transformation is built up from
# components rather than all built into `ContinuousDistribution`.

def _shift_scale_distribution_function_2arg(func):
    def wrapped(self, x, y, *args, loc, scale, sign, **kwargs):
        item = func.__name__

        f = getattr(self._dist, item)

        # Obviously it's possible to get away with half of the work here.
        # Let's focus on correct results first and optimize later.
        xt = self._transform(x, loc, scale)
        yt = self._transform(y, loc, scale)
        fxy = f(xt, yt, *args, **kwargs)
        fyx = f(yt, xt, *args, **kwargs)
        return np.real_if_close(np.where(sign, fxy, fyx))[()]

    return wrapped

def _shift_scale_distribution_function(func):
    # c is for complementary
    citem = {'_logcdf_dispatch': '_logccdf_dispatch',
             '_cdf_dispatch': '_ccdf_dispatch',
             '_logccdf_dispatch': '_logcdf_dispatch',
             '_ccdf_dispatch': '_cdf_dispatch'}
    def wrapped(self, x, *args, loc, scale, sign, **kwargs):
        item = func.__name__

        f = getattr(self._dist, item)
        cf = getattr(self._dist, citem[item])

        # Obviously it's possible to get away with half of the work here.
        # Let's focus on correct results first and optimize later.
        xt = self._transform(x, loc, scale)
        fx = f(xt, *args, **kwargs)
        cfx = cf(xt, *args, **kwargs)
        return np.where(sign, fx, cfx)[()]

    return wrapped

def _shift_scale_inverse_function(func):
    citem = {'_ilogcdf_dispatch': '_ilogccdf_dispatch',
             '_icdf_dispatch': '_iccdf_dispatch',
             '_ilogccdf_dispatch': '_ilogcdf_dispatch',
             '_iccdf_dispatch': '_icdf_dispatch'}
    def wrapped(self, p, *args, loc, scale, sign, **kwargs):
        item = func.__name__

        f = getattr(self._dist, item)
        cf = getattr(self._dist, citem[item])

        # Obviously it's possible to get away with half of the work here.
        # Let's focus on correct results first and optimize later.
        fx =  self._itransform(f(p, *args, **kwargs), loc, scale)
        cfx = self._itransform(cf(p, *args, **kwargs), loc, scale)
        return np.where(sign, fx, cfx)[()]

    return wrapped


class TransformedDistribution(ContinuousDistribution):
    def __init__(self, X, /, *args, **kwargs):
        if not isinstance(X, ContinuousDistribution):
            message = "Transformations are currently only supported for continuous RVs."
            raise NotImplementedError(message)
        self._copy_parameterization()
        self._variable = X._variable
        self._dist = X
        if X._parameterization:
            # Add standard distribution parameters to our parameterization
            dist_parameters = X._parameterization.parameters
            set_params = set(dist_parameters)
            if not self._parameterizations:
                self._parameterizations.append(_Parameterization())
            for parameterization in self._parameterizations:
                if set_params.intersection(parameterization.parameters):
                    message = (f"One or more of the parameters of {X} has "
                               "the same name as a parameter of "
                               f"{self.__class__.__name__}. Name collisions "
                               "create ambiguities and are not supported.")
                    raise ValueError(message)
                parameterization.parameters.update(dist_parameters)
        super().__init__(*args, **kwargs)

    def _overrides(self, method_name):
        return (self._dist._overrides(method_name)
                or super()._overrides(method_name))

    def reset_cache(self):
        self._dist.reset_cache()
        super().reset_cache()

    def _update_parameters(self, *, validation_policy=None, **params):
        # maybe broadcast everything before processing?
        parameters = {}
        # There may be some issues with _original_parameters
        # We only want to update with _dist._original_parameters during
        # initialization. Afterward that, we want to start with
        # self._original_parameters.
        parameters.update(self._dist._original_parameters)
        parameters.update(params)
        super()._update_parameters(validation_policy=validation_policy, **parameters)

    def _process_parameters(self, **params):
        return self._dist._process_parameters(**params)

    def __repr__(self):
        raise NotImplementedError()

    def __str__(self):
        raise NotImplementedError()


class TruncatedDistribution(TransformedDistribution):
    """Truncated distribution."""
    # TODO:
    # - consider avoiding catastropic cancellation by using appropriate tail
    # - if the mode of `_dist` is within the support, it's still the mode
    # - rejection sampling might be more efficient than inverse transform

    _lb_domain = _RealInterval(endpoints=(-inf, 'ub'), inclusive=(True, False))
    _lb_param = _RealParameter('lb', symbol=r'b_l',
                                domain=_lb_domain, typical=(0.1, 0.2))

    _ub_domain = _RealInterval(endpoints=('lb', inf), inclusive=(False, True))
    _ub_param = _RealParameter('ub', symbol=r'b_u',
                                  domain=_ub_domain, typical=(0.8, 0.9))

    _parameterizations = [_Parameterization(_lb_param, _ub_param),
                          _Parameterization(_lb_param),
                          _Parameterization(_ub_param)]

    def __init__(self, X, /, *args, lb=-np.inf, ub=np.inf, **kwargs):
        return super().__init__(X, *args, lb=lb, ub=ub, **kwargs)

    def _process_parameters(self, lb=None, ub=None, **params):
        lb = lb if lb is not None else np.full_like(lb, -np.inf)[()]
        ub = ub if ub is not None else np.full_like(ub, np.inf)[()]
        parameters = self._dist._process_parameters(**params)
        a, b = self._support(lb=lb, ub=ub, **parameters)
        logmass = self._dist._logcdf2_dispatch(a, b, **parameters)
        parameters.update(dict(lb=lb, ub=ub, _a=a, _b=b, logmass=logmass))
        return parameters

    def _support(self, lb, ub, **params):
        a, b = self._dist._support(**params)
        return np.maximum(a, lb), np.minimum(b, ub)

    def _overrides(self, method_name):
        return False

    def _logpdf_dispatch(self, x, *args, lb, ub, _a, _b, logmass, **params):
        logpdf = self._dist._logpdf_dispatch(x, *args, **params)
        return logpdf - logmass

    def _logcdf_dispatch(self, x, *args, lb, ub, _a, _b, logmass, **params):
        logcdf = self._dist._logcdf2_dispatch(_a, x, *args, **params)
        # of course, if this result is small we could compute with the other tail
        return logcdf - logmass

    def _logccdf_dispatch(self, x, *args, lb, ub, _a, _b, logmass, **params):
        logccdf = self._dist._logcdf2_dispatch(x, _b, *args, **params)
        return logccdf - logmass

    def _logcdf2_dispatch(self, x, y, *args, lb, ub, _a, _b, logmass, **params):
        logcdf2 = self._dist._logcdf2_dispatch(x, y, *args, **params)
        return logcdf2 - logmass

    def _ilogcdf_dispatch(self, logp, *args, lb, ub, _a, _b, logmass, **params):
        log_Fa = self._dist._logcdf_dispatch(_a, *args, **params)
        logp_adjusted = np.logaddexp(log_Fa, logp + logmass)
        return self._dist._ilogcdf_dispatch(logp_adjusted, *args, **params)

    def _ilogccdf_dispatch(self, logp, *args, lb, ub, _a, _b, logmass, **params):
        log_cFb = self._dist._logccdf_dispatch(_b, *args, **params)
        logp_adjusted = np.logaddexp(log_cFb, logp + logmass)
        return self._dist._ilogccdf_dispatch(logp_adjusted, *args, **params)

    def _icdf_dispatch(self, p, *args, lb, ub, _a, _b, logmass, **params):
        Fa = self._dist._cdf_dispatch(_a, *args, **params)
        p_adjusted = Fa + p*np.exp(logmass)
        return self._dist._icdf_dispatch(p_adjusted, *args, **params)

    def _iccdf_dispatch(self, p, *args, lb, ub, _a, _b, logmass, **params):
        cFb = self._dist._ccdf_dispatch(_b, *args, **params)
        p_adjusted = cFb + p*np.exp(logmass)
        return self._dist._iccdf_dispatch(p_adjusted, *args, **params)

    def __repr__(self):
        with np.printoptions(threshold=10):
            return (f"truncate({repr(self._dist)}, "
                    f"lb={repr(self.lb)}, ub={repr(self.ub)})")

    def __str__(self):
        with np.printoptions(threshold=10):
            return (f"truncate({str(self._dist)}, "
                    f"lb={str(self.lb)}, ub={str(self.ub)})")


def truncate(X, lb=-np.inf, ub=np.inf):
    """Truncate the support of a random variable.

    Given a random variable `X`, `truncate` returns a random variable with
    support truncated to the interval between `lb` and `ub`. The underlying
    probability density function is normalized accordingly.

    Parameters
    ----------
    X : `ContinuousDistribution`
        The random variable to be truncated.
    lb, ub : float array-like
        The lower and upper truncation points, respectively. Must be
        broadcastable with one another and the shape of `X`.

    Returns
    -------
    X : `ContinuousDistribution`
        The truncated random variable.

    References
    ----------
    .. [1] "Truncated Distribution". *Wikipedia*.
           https://en.wikipedia.org/wiki/Truncated_distribution

    Examples
    --------
    Compare against `scipy.stats.truncnorm`, which truncates a standard normal,
    *then* shifts and scales it.

    >>> import numpy as np
    >>> import matplotlib.pyplot as plt
    >>> from scipy import stats
    >>> loc, scale, lb, ub = 1, 2, -2, 2
    >>> X = stats.truncnorm(lb, ub, loc, scale)
    >>> Y = scale * stats.truncate(stats.Normal(), lb, ub) + loc
    >>> x = np.linspace(-3, 5, 300)
    >>> plt.plot(x, X.pdf(x), '-', label='X')
    >>> plt.plot(x, Y.pdf(x), '--', label='Y')
    >>> plt.xlabel('x')
    >>> plt.ylabel('PDF')
    >>> plt.title('Truncated, then Shifted/Scaled Normal')
    >>> plt.legend()
    >>> plt.show()

    However, suppose we wish to shift and scale a normal random variable,
    then truncate its support to given values. This is straightforward with
    `truncate`.

    >>> Z = stats.truncate(scale * stats.Normal() + loc, lb, ub)
    >>> Z.plot()
    >>> plt.show()

    Furthermore, `truncate` can be applied to any random variable:

    >>> Rayleigh = stats.make_distribution(stats.rayleigh)
    >>> W = stats.truncate(Rayleigh(), lb=0.5, ub=3)
    >>> W.plot()
    >>> plt.show()

    """
    return TruncatedDistribution(X, lb=lb, ub=ub)


class ShiftedScaledDistribution(TransformedDistribution):
    """Distribution with a standard shift/scale transformation."""
    # Unclear whether infinite loc/scale will work reasonably in all cases
    _loc_domain = _RealInterval(endpoints=(-inf, inf), inclusive=(True, True))
    _loc_param = _RealParameter('loc', symbol=r'\mu',
                                domain=_loc_domain, typical=(1, 2))

    _scale_domain = _RealInterval(endpoints=(-inf, inf), inclusive=(True, True))
    _scale_param = _RealParameter('scale', symbol=r'\sigma',
                                  domain=_scale_domain, typical=(0.1, 10))

    _parameterizations = [_Parameterization(_loc_param, _scale_param),
                          _Parameterization(_loc_param),
                          _Parameterization(_scale_param)]

    def _process_parameters(self, loc=None, scale=None, **params):
        loc = loc if loc is not None else np.zeros_like(scale)[()]
        scale = scale if scale is not None else np.ones_like(loc)[()]
        sign = scale > 0
        parameters = self._dist._process_parameters(**params)
        parameters.update(dict(loc=loc, scale=scale, sign=sign))
        return parameters

    def _transform(self, x, loc, scale, **kwargs):
        return (x - loc)/scale

    def _itransform(self, x, loc, scale, **kwargs):
        return x * scale + loc

    def _support(self, loc, scale, sign, **params):
        # Add shortcut for infinite support?
        a, b = self._dist._support(**params)
        a, b = self._itransform(a, loc, scale), self._itransform(b, loc, scale)
        return np.where(sign, a, b)[()], np.where(sign, b, a)[()]

    def __repr__(self):
        with np.printoptions(threshold=10):
            result =  f"{repr(self.scale)}*{repr(self._dist)}"
            if not self.loc.ndim and self.loc < 0:
                result += f" - {repr(-self.loc)}"
            elif (np.any(self.loc != 0)
                  or not np.can_cast(self.loc.dtype, self.scale.dtype)):
                # We don't want to hide a zero array loc if it can cause
                # a type promotion.
                result += f" + {repr(self.loc)}"
        return result

    def __str__(self):
        with np.printoptions(threshold=10):
            result =  f"{str(self.scale)}*{str(self._dist)}"
            if not self.loc.ndim and self.loc < 0:
                result += f" - {str(-self.loc)}"
            elif (np.any(self.loc != 0)
                  or not np.can_cast(self.loc.dtype, self.scale.dtype)):
                # We don't want to hide a zero array loc if it can cause
                # a type promotion.
                result += f" + {str(self.loc)}"
        return result

    # Here, we override all the `_dispatch` methods rather than the public
    # methods or _function methods. Why not the public methods?
    # If we were to override the public methods, then other
    # TransformedDistribution classes (which could transform a
    # ShiftedScaledDistribution) would need to call the public methods of
    # ShiftedScaledDistribution, which would run the input validation again.
    # Why not the _function methods? For distributions that rely on the
    # default implementation of methods (e.g. `quadrature`, `inversion`),
    # the implementation would "see" the location and scale like other
    # distribution parameters, so they could affect the accuracy of the
    # calculations. I think it is cleaner if `loc` and `scale` do not affect
    # the underlying calculations at all.

    def _entropy_dispatch(self, *args, loc, scale, sign, **params):
        return (self._dist._entropy_dispatch(*args, **params)
                + np.log(np.abs(scale)))

    def _logentropy_dispatch(self, *args, loc, scale, sign, **params):
        lH0 = self._dist._logentropy_dispatch(*args, **params)
        lls = np.log(np.log(np.abs(scale))+0j)
        return special.logsumexp(np.broadcast_arrays(lH0, lls), axis=0)

    def _median_dispatch(self, *, method, loc, scale, sign, **params):
        raw = self._dist._median_dispatch(method=method, **params)
        return self._itransform(raw, loc, scale)

    def _mode_dispatch(self, *, method, loc, scale, sign, **params):
        raw = self._dist._mode_dispatch(method=method, **params)
        return self._itransform(raw, loc, scale)

    def _logpdf_dispatch(self, x, *args, loc, scale, sign, **params):
        x = self._transform(x, loc, scale)
        logpdf = self._dist._logpdf_dispatch(x, *args, **params)
        return logpdf - np.log(np.abs(scale))

    def _pdf_dispatch(self, x, *args, loc, scale, sign, **params):
        x = self._transform(x, loc, scale)
        pdf = self._dist._pdf_dispatch(x, *args, **params)
        return pdf / np.abs(scale)

    def _logpmf_dispatch(self, x, *args, loc, scale, sign, **params):
        x = self._transform(x, loc, scale)
        logpmf = self._dist._logpmf_dispatch(x, *args, **params)
        return logpmf - np.log(np.abs(scale))

    def _pmf_dispatch(self, x, *args, loc, scale, sign, **params):
        x = self._transform(x, loc, scale)
        pmf = self._dist._pmf_dispatch(x, *args, **params)
        return pmf / np.abs(scale)

    def _logpxf_dispatch(self, x, *args, loc, scale, sign, **params):
        x = self._transform(x, loc, scale)
        logpxf = self._dist._logpxf_dispatch(x, *args, **params)
        return logpxf - np.log(np.abs(scale))

    def _pxf_dispatch(self, x, *args, loc, scale, sign, **params):
        x = self._transform(x, loc, scale)
        pxf = self._dist._pxf_dispatch(x, *args, **params)
        return pxf / np.abs(scale)

    # Sorry about the magic. This is just a draft to show the behavior.
    @_shift_scale_distribution_function
    def _logcdf_dispatch(self, x, *, method=None, **params):
        pass

    @_shift_scale_distribution_function
    def _cdf_dispatch(self, x, *, method=None, **params):
        pass

    @_shift_scale_distribution_function
    def _logccdf_dispatch(self, x, *, method=None, **params):
        pass

    @_shift_scale_distribution_function
    def _ccdf_dispatch(self, x, *, method=None, **params):
        pass

    @_shift_scale_distribution_function_2arg
    def _logcdf2_dispatch(self, x, y, *, method=None, **params):
        pass

    @_shift_scale_distribution_function_2arg
    def _cdf2_dispatch(self, x, y, *, method=None, **params):
        pass

    @_shift_scale_distribution_function_2arg
    def _logccdf2_dispatch(self, x, y, *, method=None, **params):
        pass

    @_shift_scale_distribution_function_2arg
    def _ccdf2_dispatch(self, x, y, *, method=None, **params):
        pass

    @_shift_scale_inverse_function
    def _ilogcdf_dispatch(self, x, *, method=None, **params):
        pass

    @_shift_scale_inverse_function
    def _icdf_dispatch(self, x, *, method=None, **params):
        pass

    @_shift_scale_inverse_function
    def _ilogccdf_dispatch(self, x, *, method=None, **params):
        pass

    @_shift_scale_inverse_function
    def _iccdf_dispatch(self, x, *, method=None, **params):
        pass

    def _moment_standardized_dispatch(self, order, *, loc, scale, sign, methods,
                                      **params):
        res = (self._dist._moment_standardized_dispatch(
            order, methods=methods, **params))
        return None if res is None else res * np.sign(scale)**order

    def _moment_central_dispatch(self, order, *, loc, scale, sign, methods,
                                 **params):
        res = (self._dist._moment_central_dispatch(
            order, methods=methods, **params))
        return None if res is None else res * scale**order

    def _moment_raw_dispatch(self, order, *, loc, scale, sign, methods,
                             **params):
        raw_moments = []
        methods_highest_order = methods
        for i in range(int(order) + 1):
            methods = (self._moment_methods if i < order
                       else methods_highest_order)
            raw = self._dist._moment_raw_dispatch(i, methods=methods, **params)
            if raw is None:
                return None
            moment_i = raw * scale**i
            raw_moments.append(moment_i)

        return self._moment_transform_center(
            order, raw_moments, loc, self._zero)

    def _sample_dispatch(self, full_shape, *,
                         rng, loc, scale, sign, method, **params):
        rvs = self._dist._sample_dispatch(full_shape, method=method, rng=rng, **params)
        return self._itransform(rvs, loc=loc, scale=scale, sign=sign, **params)

    def __add__(self, loc):
        return ShiftedScaledDistribution(self._dist, loc=self.loc + loc,
                                         scale=self.scale)

    def __sub__(self, loc):
        return ShiftedScaledDistribution(self._dist, loc=self.loc - loc,
                                         scale=self.scale)

    def __mul__(self, scale):
        return ShiftedScaledDistribution(self._dist,
                                         loc=self.loc * scale,
                                         scale=self.scale * scale)

    def __truediv__(self, scale):
        return ShiftedScaledDistribution(self._dist,
                                         loc=self.loc / scale,
                                         scale=self.scale / scale)


class OrderStatisticDistribution(TransformedDistribution):
    r"""Probability distribution of an order statistic

    An instance of this class represents a random variable that follows the
    distribution underlying the :math:`r^{\text{th}}` order statistic of a
    sample of :math:`n` observations of a random variable :math:`X`.

    Parameters
    ----------
    dist : `ContinuousDistribution`
        The random variable :math:`X`
    n : array_like
        The (integer) sample size :math:`n`
    r : array_like
        The (integer) rank of the order statistic :math:`r`


    Notes
    -----
    If we make :math:`n` observations of a continuous random variable
    :math:`X` and sort them in increasing order
    :math:`X_{(1)}, \dots, X_{(r)}, \dots, X_{(n)}`,
    :math:`X_{(r)}` is known as the :math:`r^{\text{th}}` order statistic.

    If the PDF, CDF, and CCDF underlying math:`X` are denoted :math:`f`,
    :math:`F`, and :math:`F'`, respectively, then the PDF underlying
    math:`X_{(r)}` is given by:

    .. math::

        f_r(x) = \frac{n!}{(r-1)! (n-r)!} f(x) F(x)^{r-1} F'(x)^{n - r}

    The CDF and other methods of the distribution underlying :math:`X_{(r)}`
    are calculated using the fact that :math:`X = F^{-1}(U)`, where :math:`U` is
    a standard uniform random variable, and that the order statistics of
    observations of `U` follow a beta distribution, :math:`B(r, n - r + 1)`.

    References
    ----------
    .. [1] Order statistic. *Wikipedia*. https://en.wikipedia.org/wiki/Order_statistic

    Examples
    --------
    Suppose we are interested in order statistics of samples of size five drawn
    from the standard normal distribution. Plot the PDF underlying the fourth
    order statistic and compare with a normalized histogram from simulation.

    >>> import numpy as np
    >>> import matplotlib.pyplot as plt
    >>> from scipy import stats
    >>> from scipy.stats._distribution_infrastructure import OrderStatisticDistribution
    >>>
    >>> X = stats.Normal()
    >>> data = X.sample(shape=(10000, 5))
    >>> ranks = np.sort(data, axis=1)
    >>> Y = OrderStatisticDistribution(X, r=4, n=5)
    >>>
    >>> ax = plt.gca()
    >>> Y.plot(ax=ax)
    >>> ax.hist(ranks[:, 3], density=True, bins=30)
    >>> plt.show()

    """

    # These can be restricted to _IntegerInterval/_IntegerParameter in a separate
    # PR if desired.
    _r_domain = _RealInterval(endpoints=(1, 'n'), inclusive=(True, True))
    _r_param = _RealParameter('r', domain=_r_domain, typical=(1, 2))

    _n_domain = _RealInterval(endpoints=(1, np.inf), inclusive=(True, True))
    _n_param = _RealParameter('n', domain=_n_domain, typical=(1, 4))

    _r_domain.define_parameters(_n_param)

    _parameterizations = [_Parameterization(_r_param, _n_param)]

    def __init__(self, dist, /, *args, r, n, **kwargs):
        super().__init__(dist, *args, r=r, n=n, **kwargs)

    def _support(self, *args, r, n, **kwargs):
        return self._dist._support(*args, **kwargs)

    def _process_parameters(self, r=None, n=None, **params):
        parameters = self._dist._process_parameters(**params)
        parameters.update(dict(r=r, n=n))
        return parameters

    def _overrides(self, method_name):
        return method_name in {'_logpdf_formula', '_pdf_formula',
                               '_cdf_formula', '_ccdf_formula',
                               '_icdf_formula', '_iccdf_formula'}

    def _logpdf_formula(self, x, r, n, **kwargs):
        log_factor = special.betaln(r, n - r + 1)
        log_fX = self._dist._logpdf_dispatch(x, **kwargs)
        # log-methods sometimes use complex dtype with 0 imaginary component,
        # but `_tanhsinh` doesn't accept complex limits of integration; take `real`.
        log_FX = self._dist._logcdf_dispatch(x.real, **kwargs)
        log_cFX = self._dist._logccdf_dispatch(x.real, **kwargs)
        # This can be problematic when (r - 1)|(n-r) = 0 and `log_FX`|log_cFX = -inf
        # The PDF in these cases is 0^0, so these should be replaced with log(1)=0
        # return log_fX + (r-1)*log_FX + (n-r)*log_cFX - log_factor
        rm1_log_FX = np.where((r - 1 == 0) & np.isneginf(log_FX), 0, (r-1)*log_FX)
        nmr_log_cFX = np.where((n - r == 0) & np.isneginf(log_cFX), 0, (n-r)*log_cFX)
        return log_fX + rm1_log_FX + nmr_log_cFX - log_factor

    def _pdf_formula(self, x, r, n, **kwargs):
        # 1 / factor = factorial(n) / (factorial(r-1) * factorial(n-r))
        factor = special.beta(r, n - r + 1)
        fX = self._dist._pdf_dispatch(x, **kwargs)
        FX = self._dist._cdf_dispatch(x, **kwargs)
        cFX = self._dist._ccdf_dispatch(x, **kwargs)
        return fX * FX**(r-1) * cFX**(n-r) / factor

    def _cdf_formula(self, x, r, n, **kwargs):
        x_ = self._dist._cdf_dispatch(x, **kwargs)
        return special.betainc(r, n-r+1, x_)

    def _ccdf_formula(self, x, r, n, **kwargs):
        x_ = self._dist._cdf_dispatch(x, **kwargs)
        return special.betaincc(r, n-r+1, x_)

    def _icdf_formula(self, p, r, n, **kwargs):
        p_ = special.betaincinv(r, n-r+1, p)
        return self._dist._icdf_dispatch(p_, **kwargs)

    def _iccdf_formula(self, p, r, n, **kwargs):
        p_ = special.betainccinv(r, n-r+1, p)
        return self._dist._icdf_dispatch(p_, **kwargs)

    def __repr__(self):
        with np.printoptions(threshold=10):
            return (f"order_statistic({repr(self._dist)}, r={repr(self.r)}, "
                    f"n={repr(self.n)})")

    def __str__(self):
        with np.printoptions(threshold=10):
            return (f"order_statistic({str(self._dist)}, r={str(self.r)}, "
                    f"n={str(self.n)})")


def order_statistic(X, /, *, r, n):
    r"""Probability distribution of an order statistic

    Returns a random variable that follows the distribution underlying the
    :math:`r^{\text{th}}` order statistic of a sample of :math:`n`
    observations of a random variable :math:`X`.

    Parameters
    ----------
    X : `ContinuousDistribution`
        The random variable :math:`X`
    r : array_like
        The (positive integer) rank of the order statistic :math:`r`
    n : array_like
        The (positive integer) sample size :math:`n`

    Returns
    -------
    Y : `ContinuousDistribution`
        A random variable that follows the distribution of the prescribed
        order statistic.

    Notes
    -----
    If we make :math:`n` observations of a continuous random variable
    :math:`X` and sort them in increasing order
    :math:`X_{(1)}, \dots, X_{(r)}, \dots, X_{(n)}`,
    :math:`X_{(r)}` is known as the :math:`r^{\text{th}}` order statistic.

    If the PDF, CDF, and CCDF underlying math:`X` are denoted :math:`f`,
    :math:`F`, and :math:`F'`, respectively, then the PDF underlying
    math:`X_{(r)}` is given by:

    .. math::

        f_r(x) = \frac{n!}{(r-1)! (n-r)!} f(x) F(x)^{r-1} F'(x)^{n - r}

    The CDF and other methods of the distribution underlying :math:`X_{(r)}`
    are calculated using the fact that :math:`X = F^{-1}(U)`, where :math:`U` is
    a standard uniform random variable, and that the order statistics of
    observations of `U` follow a beta distribution, :math:`B(r, n - r + 1)`.

    References
    ----------
    .. [1] Order statistic. *Wikipedia*. https://en.wikipedia.org/wiki/Order_statistic

    Examples
    --------
    Suppose we are interested in order statistics of samples of size five drawn
    from the standard normal distribution. Plot the PDF underlying each
    order statistic and compare with a normalized histogram from simulation.

    >>> import numpy as np
    >>> import matplotlib.pyplot as plt
    >>> from scipy import stats
    >>>
    >>> X = stats.Normal()
    >>> data = X.sample(shape=(10000, 5))
    >>> sorted = np.sort(data, axis=1)
    >>> Y = stats.order_statistic(X, r=[1, 2, 3, 4, 5], n=5)
    >>>
    >>> ax = plt.gca()
    >>> colors = plt.rcParams['axes.prop_cycle'].by_key()['color']
    >>> for i in range(5):
    ...     y = sorted[:, i]
    ...     ax.hist(y, density=True, bins=30, alpha=0.1, color=colors[i])
    >>> Y.plot(ax=ax)
    >>> plt.show()

    """
    r, n = np.asarray(r), np.asarray(n)
    if np.any((r != np.floor(r)) | (r < 0)) or np.any((n != np.floor(n)) | (n < 0)):
        message = "`r` and `n` must contain only positive integers."
        raise ValueError(message)
    return OrderStatisticDistribution(X, r=r, n=n)


class Mixture(_ProbabilityDistribution):
    r"""Representation of a mixture distribution.

    A mixture distribution is the distribution of a random variable
    defined in the following way: first, a random variable is selected
    from `components` according to the probabilities given by `weights`, then
    the selected random variable is realized.

    Parameters
    ----------
    components : sequence of `ContinuousDistribution`
        The underlying instances of `ContinuousDistribution`.
        All must have scalar shape parameters (if any); e.g., the `pdf` evaluated
        at a scalar argument must return a scalar.
    weights : sequence of floats, optional
        The corresponding probabilities of selecting each random variable.
        Must be non-negative and sum to one. The default behavior is to weight
        all components equally.

    Attributes
    ----------
    components : sequence of `ContinuousDistribution`
        The underlying instances of `ContinuousDistribution`.
    weights : ndarray
        The corresponding probabilities of selecting each random variable.

    Methods
    -------
    support

    sample

    moment

    mean
    median
    mode

    variance
    standard_deviation

    skewness
    kurtosis

    pdf
    logpdf

    cdf
    icdf
    ccdf
    iccdf

    logcdf
    ilogcdf
    logccdf
    ilogccdf

    entropy

    Notes
    -----
    The following abbreviations are used throughout the documentation.

    - PDF: probability density function
    - CDF: cumulative distribution function
    - CCDF: complementary CDF
    - entropy: differential entropy
    - log-*F*: logarithm of *F* (e.g. log-CDF)
    - inverse *F*: inverse function of *F* (e.g. inverse CDF)

    References
    ----------
    .. [1] Mixture distribution, *Wikipedia*,
           https://en.wikipedia.org/wiki/Mixture_distribution


    Examples
    --------
    A mixture of normal distributions:

    >>> import numpy as np
    >>> from scipy import stats
    >>> import matplotlib.pyplot as plt
    >>> X1 = stats.Normal(mu=-2, sigma=1)
    >>> X2 = stats.Normal(mu=2, sigma=1)
    >>> mixture = stats.Mixture([X1, X2], weights=[0.4, 0.6])
    >>> print(f'mean: {mixture.mean():.2f}, '
    ...       f'median: {mixture.median():.2f}, '
    ...       f'mode: {mixture.mode():.2f}')
    mean: 0.40, median: 1.04, mode: 2.00
    >>> x = np.linspace(-10, 10, 300)
    >>> plt.plot(x, mixture.pdf(x))
    >>> plt.title('PDF of normal distribution mixture')
    >>> plt.show()

    """
    # Todo:
    # Add support for array shapes, weights

    def _input_validation(self, components, weights):
        if len(components) == 0:
            message = ("`components` must contain at least one random variable.")
            raise ValueError(message)

        for var in components:
            # will generalize to other kinds of distributions when there
            # *are* other kinds of distributions
            if not isinstance(var, ContinuousDistribution):
                message = ("Each element of `components` must be an instance of "
                           "`ContinuousDistribution`.")
                raise ValueError(message)
            if not var._shape == ():
                message = "All elements of `components` must have scalar shapes."
                raise ValueError(message)

        if weights is None:
            return components, weights

        weights = np.asarray(weights)
        if weights.shape != (len(components),):
            message = "`components` and `weights` must have the same length."
            raise ValueError(message)

        if not np.issubdtype(weights.dtype, np.inexact):
            message = "`weights` must have floating point dtype."
            raise ValueError(message)

        if not np.isclose(np.sum(weights), 1.0):
            message = "`weights` must sum to 1.0."
            raise ValueError(message)

        if not np.all(weights >= 0):
            message = "All `weights` must be non-negative."
            raise ValueError(message)

        return components, weights

    def __init__(self, components, *, weights=None):
        components, weights = self._input_validation(components, weights)
        n = len(components)
        dtype = np.result_type(*(var._dtype for var in components))
        self._shape = np.broadcast_shapes(*(var._shape for var in components))
        self._dtype, self._components = dtype, components
        self._weights = np.full(n, 1/n, dtype=dtype) if weights is None else weights
        self.validation_policy = None

    @property
    def components(self):
        return list(self._components)

    @property
    def weights(self):
        return self._weights.copy()

    def _full(self, val, *args):
        args = [np.asarray(arg) for arg in args]
        dtype = np.result_type(self._dtype, *(arg.dtype for arg in args))
        shape = np.broadcast_shapes(self._shape, *(arg.shape for arg in args))
        return np.full(shape, val, dtype=dtype)

    def _sum(self, fun, *args):
        out = self._full(0, *args)
        for var, weight in zip(self._components, self._weights):
            out += getattr(var, fun)(*args) * weight
        return out[()]

    def _logsum(self, fun, *args):
        out = self._full(-np.inf, *args)
        for var, log_weight in zip(self._components, np.log(self._weights)):
            np.logaddexp(out, getattr(var, fun)(*args) + log_weight, out=out)
        return out[()]

    def support(self):
        a = self._full(np.inf)
        b = self._full(-np.inf)
        for var in self._components:
            a = np.minimum(a, var.support()[0])
            b = np.maximum(b, var.support()[1])
        return a, b

    def _raise_if_method(self, method):
        if method is not None:
            raise NotImplementedError("`method` not implemented for this distribution.")

    def logentropy(self, *, method=None):
        self._raise_if_method(method)
        def log_integrand(x):
            # `x` passed by `_tanhsinh` will be of complex dtype because
            # `log_integrand` returns complex values, but the imaginary
            # component is always zero. Extract the real part because
            # `logpdf` uses `logaddexp`, which fails for complex input.
            return self.logpdf(x.real) + np.log(self.logpdf(x.real) + 0j)

        res = _tanhsinh(log_integrand, *self.support(), log=True).integral
        return _log_real_standardize(res + np.pi*1j)

    def entropy(self, *, method=None):
        self._raise_if_method(method)
        return _tanhsinh(lambda x: -self.pdf(x) * self.logpdf(x),
                         *self.support()).integral

    def mode(self, *, method=None):
        self._raise_if_method(method)
        a, b = self.support()
        def f(x): return -self.pdf(x)
        res = _bracket_minimum(f, 1., xmin=a, xmax=b)
        res = _chandrupatla_minimize(f, res.xl, res.xm, res.xr)
        return res.x

    def median(self, *, method=None):
        self._raise_if_method(method)
        return self.icdf(0.5)

    def mean(self, *, method=None):
        self._raise_if_method(method)
        return self._sum('mean')

    def variance(self, *, method=None):
        self._raise_if_method(method)
        return self._moment_central(2)

    def standard_deviation(self, *, method=None):
        self._raise_if_method(method)
        return self.variance()**0.5

    def skewness(self, *, method=None):
        self._raise_if_method(method)
        return self._moment_standardized(3)

    def kurtosis(self, *, method=None):
        self._raise_if_method(method)
        return self._moment_standardized(4)

    def moment(self, order=1, kind='raw', *, method=None):
        self._raise_if_method(method)
        kinds = {'raw': self._moment_raw,
                 'central': self._moment_central,
                 'standardized': self._moment_standardized}
        order = ContinuousDistribution._validate_order_kind(self, order, kind, kinds)
        moment_kind = kinds[kind]
        return moment_kind(order)

    def _moment_raw(self, order):
        out = self._full(0)
        for var, weight in zip(self._components, self._weights):
            out += var.moment(order, kind='raw') * weight
        return out[()]

    def _moment_central(self, order):
        order = int(order)
        out = self._full(0)
        for var, weight in zip(self._components, self._weights):
            moment_as = [var.moment(order, kind='central')
                         for order in range(order + 1)]
            a, b = var.mean(), self.mean()
            moment = var._moment_transform_center(order, moment_as, a, b)
            out += moment * weight
        return out[()]

    def _moment_standardized(self, order):
        return self._moment_central(order) / self.standard_deviation()**order

    def pdf(self, x, /, *, method=None):
        self._raise_if_method(method)
        return self._sum('pdf', x)

    def logpdf(self, x, /, *, method=None):
        self._raise_if_method(method)
        return self._logsum('logpdf', x)

    def pmf(self, x, /, *, method=None):
        self._raise_if_method(method)
        return self._sum('pmf', x)

    def logpmf(self, x, /, *, method=None):
        self._raise_if_method(method)
        return self._logsum('logpmf', x)

    def cdf(self, x, y=None, /, *, method=None):
        self._raise_if_method(method)
        args = (x,) if y is None else (x, y)
        return self._sum('cdf', *args)

    def logcdf(self, x, y=None, /, *, method=None):
        self._raise_if_method(method)
        args = (x,) if y is None else (x, y)
        return self._logsum('logcdf', *args)

    def ccdf(self, x, y=None, /, *, method=None):
        self._raise_if_method(method)
        args = (x,) if y is None else (x, y)
        return self._sum('ccdf', *args)

    def logccdf(self, x, y=None, /, *, method=None):
        self._raise_if_method(method)
        args = (x,) if y is None else (x, y)
        return self._logsum('logccdf', *args)

    def _invert(self, fun, p):
        xmin, xmax = self.support()
        fun = getattr(self, fun)
        f = lambda x, p: fun(x) - p  # noqa: E731 is silly
        xl0, xr0 = _guess_bracket(xmin, xmax)
        res = _bracket_root(f, xl0=xl0, xr0=xr0, xmin=xmin, xmax=xmax, args=(p,))
        return _chandrupatla(f, a=res.xl, b=res.xr, args=(p,)).x

    def icdf(self, p, /, *, method=None):
        self._raise_if_method(method)
        return self._invert('cdf', p)

    def iccdf(self, p, /, *, method=None):
        self._raise_if_method(method)
        return self._invert('ccdf', p)

    def ilogcdf(self, p, /, *, method=None):
        self._raise_if_method(method)
        return self._invert('logcdf', p)

    def ilogccdf(self, p, /, *, method=None):
        self._raise_if_method(method)
        return self._invert('logccdf', p)

    def sample(self, shape=(), *, rng=None, method=None):
        self._raise_if_method(method)
        rng = np.random.default_rng(rng)
        size = np.prod(np.atleast_1d(shape))
        ns = rng.multinomial(size, self._weights)
        x = [var.sample(shape=n, rng=rng) for n, var in zip(ns, self._components)]
        x = np.reshape(rng.permuted(np.concatenate(x)), shape)
        return x[()]

    def __repr__(self):
        result = "Mixture(\n"
        result += "    [\n"
        with np.printoptions(threshold=10):
            for component in self.components:
                result += f"        {repr(component)},\n"
            result += "    ],\n"
            result += f"    weights={repr(self.weights)},\n"
        result += ")"
        return result

    def __str__(self):
        result = "Mixture(\n"
        result += "    [\n"
        with np.printoptions(threshold=10):
            for component in self.components:
                result += f"        {str(component)},\n"
            result += "    ],\n"
            result += f"    weights={str(self.weights)},\n"
        result += ")"
        return result


class MonotonicTransformedDistribution(TransformedDistribution):
    r"""Distribution underlying a strictly monotonic function of a random variable

    Given a random variable :math:`X`; a strictly monotonic function
    :math:`g(u)`, its inverse :math:`h(u) = g^{-1}(u)`, and the derivative magnitude
    :math: `|h'(u)| = \left| \frac{dh(u)}{du} \right|`, define the distribution
    underlying the random variable :math:`Y = g(X)`.

    Parameters
    ----------
    X : `ContinuousDistribution`
        The random variable :math:`X`.
    g, h, dh : callable
        Elementwise functions representing the mathematical functions
        :math:`g(u)`, :math:`h(u)`, and :math:`|h'(u)|`
    logdh : callable, optional
        Elementwise function representing :math:`\log(h'(u))`.
        The default is ``lambda u: np.log(dh(u))``, but providing
        a custom implementation may avoid over/underflow.
    increasing : bool, optional
        Whether the function is strictly increasing (True, default)
        or strictly decreasing (False).
    repr_pattern : str, optional
        A string pattern for determining the __repr__. The __repr__
        for X will be substituted into the position where `***` appears.
        For example:
            ``"exp(***)"`` for the repr of an exponentially transformed
            distribution
        The default is ``f"{g.__name__}(***)"``.
    str_pattern : str, optional
        A string pattern for determining `__str__`. The `__str__`
        for X will be substituted into the position where `***` appears.
        For example:
            ``"exp(***)"`` for the repr of an exponentially transformed
            distribution
        The default is the value `repr_pattern` takes.
    """

    def __init__(self, X, /, *args, g, h, dh, logdh=None,
                 increasing=True, repr_pattern=None,
                 str_pattern=None, **kwargs):
        super().__init__(X, *args, **kwargs)
        self._g = g
        self._h = h
        self._dh = dh
        self._logdh = (logdh if logdh is not None
                       else lambda u: np.log(dh(u)))
        if increasing:
            self._xdf = self._dist._cdf_dispatch
            self._cxdf = self._dist._ccdf_dispatch
            self._ixdf = self._dist._icdf_dispatch
            self._icxdf = self._dist._iccdf_dispatch
            self._logxdf = self._dist._logcdf_dispatch
            self._logcxdf = self._dist._logccdf_dispatch
            self._ilogxdf = self._dist._ilogcdf_dispatch
            self._ilogcxdf = self._dist._ilogccdf_dispatch
        else:
            self._xdf = self._dist._ccdf_dispatch
            self._cxdf = self._dist._cdf_dispatch
            self._ixdf = self._dist._iccdf_dispatch
            self._icxdf = self._dist._icdf_dispatch
            self._logxdf = self._dist._logccdf_dispatch
            self._logcxdf = self._dist._logcdf_dispatch
            self._ilogxdf = self._dist._ilogccdf_dispatch
            self._ilogcxdf = self._dist._ilogcdf_dispatch
        self._increasing = increasing
        self._repr_pattern = repr_pattern or f"{g.__name__}(***)"
        self._str_pattern = str_pattern or self._repr_pattern

    def __repr__(self):
        with np.printoptions(threshold=10):
            return self._repr_pattern.replace("***", repr(self._dist))

    def __str__(self):
        with np.printoptions(threshold=10):
            return self._str_pattern.replace("***", str(self._dist))

    def _overrides(self, method_name):
        # Do not use the generic overrides of TransformedDistribution
        return False

    def _support(self, **params):
        a, b = self._dist._support(**params)
        # For reciprocal transformation, we want this zero to become -inf
        b = np.where(b==0, np.asarray("-0", dtype=b.dtype), b)
        with np.errstate(divide='ignore'):
            if self._increasing:
                return self._g(a), self._g(b)
            else:
                return self._g(b), self._g(a)

    def _logpdf_dispatch(self, x, *args, **params):
        return self._dist._logpdf_dispatch(self._h(x), *args, **params) + self._logdh(x)

    def _pdf_dispatch(self, x, *args, **params):
        return self._dist._pdf_dispatch(self._h(x), *args, **params) * self._dh(x)

    def _logcdf_dispatch(self, x, *args, **params):
        return self._logxdf(self._h(x), *args, **params)

    def _cdf_dispatch(self, x, *args, **params):
        return self._xdf(self._h(x), *args, **params)

    def _logccdf_dispatch(self, x, *args, **params):
        return self._logcxdf(self._h(x), *args, **params)

    def _ccdf_dispatch(self, x, *args, **params):
        return self._cxdf(self._h(x), *args, **params)

    def _ilogcdf_dispatch(self, p, *args, **params):
        return self._g(self._ilogxdf(p, *args, **params))

    def _icdf_dispatch(self, p, *args, **params):
        return self._g(self._ixdf(p, *args, **params))

    def _ilogccdf_dispatch(self, p, *args, **params):
        return self._g(self._ilogcxdf(p, *args, **params))

    def _iccdf_dispatch(self, p, *args, **params):
        return self._g(self._icxdf(p, *args, **params))

    def _sample_dispatch(self, full_shape, *, method, rng, **params):
        rvs = self._dist._sample_dispatch(full_shape, method=method, rng=rng, **params)
        return self._g(rvs)


class FoldedDistribution(TransformedDistribution):
    r"""Distribution underlying the absolute value of a random variable

    Given a random variable :math:`X`; define the distribution
    underlying the random variable :math:`Y = |X|`.

    Parameters
    ----------
    X : `ContinuousDistribution`
        The random variable :math:`X`.

    Returns
    -------
    Y : `ContinuousDistribution`
        The random variable :math:`Y = |X|`

    """
    # Many enhancements are possible if distribution is symmetric. Start
    # with the general case; enhance later.

    def __init__(self, X, /, *args, **kwargs):
        super().__init__(X, *args, **kwargs)
        # I think we need to allow `_support` to define whether the endpoints
        # are inclusive or not. In the meantime, it's best to ensure that the lower
        # endpoint (typically 0 for folded distribution) is inclusive so PDF evaluates
        # correctly at that point.
        self._variable.domain.inclusive = (True, self._variable.domain.inclusive[1])

    def _overrides(self, method_name):
        # Do not use the generic overrides of TransformedDistribution
        return False

    def _support(self, **params):
        a, b = self._dist._support(**params)
        a_, b_ = np.abs(a), np.abs(b)
        a_, b_ = np.minimum(a_, b_), np.maximum(a_, b_)
        i = (a < 0) & (b > 0)
        a_ = np.asarray(a_)
        a_[i] = 0
        return a_[()], b_[()]

    def _logpdf_dispatch(self, x, *args, method=None, **params):
        x = np.abs(x)
        right = self._dist._logpdf_dispatch(x, *args, method=method, **params)
        left = self._dist._logpdf_dispatch(-x, *args, method=method, **params)
        left = np.asarray(left)
        right = np.asarray(right)
        a, b = self._dist._support(**params)
        left[-x < a] = -np.inf
        right[x > b] = -np.inf
        logpdfs = np.stack([left, right])
        return special.logsumexp(logpdfs, axis=0)

    def _pdf_dispatch(self, x, *args, method=None, **params):
        x = np.abs(x)
        right = self._dist._pdf_dispatch(x, *args, method=method, **params)
        left = self._dist._pdf_dispatch(-x, *args, method=method, **params)
        left = np.asarray(left)
        right = np.asarray(right)
        a, b = self._dist._support(**params)
        left[-x < a] = 0
        right[x > b] = 0
        return left + right

    def _logcdf_dispatch(self, x, *args, method=None, **params):
        x = np.abs(x)
        a, b = self._dist._support(**params)
        xl = np.maximum(-x, a)
        xr = np.minimum(x, b)
        return self._dist._logcdf2_dispatch(xl, xr, *args, method=method, **params).real

    def _cdf_dispatch(self, x, *args, method=None, **params):
        x = np.abs(x)
        a, b = self._dist._support(**params)
        xl = np.maximum(-x, a)
        xr = np.minimum(x, b)
        return self._dist._cdf2_dispatch(xl, xr, *args, **params)

    def _logccdf_dispatch(self, x, *args, method=None, **params):
        x = np.abs(x)
        a, b = self._dist._support(**params)
        xl = np.maximum(-x, a)
        xr = np.minimum(x, b)
        return self._dist._logccdf2_dispatch(xl, xr, *args, method=method,
                                             **params).real

    def _ccdf_dispatch(self, x, *args, method=None, **params):
        x = np.abs(x)
        a, b = self._dist._support(**params)
        xl = np.maximum(-x, a)
        xr = np.minimum(x, b)
        return self._dist._ccdf2_dispatch(xl, xr, *args, method=method, **params)

    def _sample_dispatch(self, full_shape, *, method, rng, **params):
        rvs = self._dist._sample_dispatch(full_shape, method=method, rng=rng, **params)
        return np.abs(rvs)

    def __repr__(self):
        with np.printoptions(threshold=10):
            return f"abs({repr(self._dist)})"

    def __str__(self):
        with np.printoptions(threshold=10):
            return f"abs({str(self._dist)})"


def abs(X, /):
    r"""Absolute value of a random variable

    Parameters
    ----------
    X : `ContinuousDistribution`
        The random variable :math:`X`.

    Returns
    -------
    Y : `ContinuousDistribution`
        A random variable :math:`Y = |X|`.

    Examples
    --------
    Suppose we have a normally distributed random variable :math:`X`:

    >>> import numpy as np
    >>> from scipy import stats
    >>> X = stats.Normal()

    We wish to have a random variable :math:`Y` distributed according to
    the folded normal distribution; that is, a random variable :math:`|X|`.

    >>> Y = stats.abs(X)

    The PDF of the distribution in the left half plane is "folded" over to
    the right half plane. Because the normal PDF is symmetric, the resulting
    PDF is zero for negative arguments and doubled for positive arguments.

    >>> import matplotlib.pyplot as plt
    >>> x = np.linspace(0, 5, 300)
    >>> ax = plt.gca()
    >>> Y.plot(x='x', y='pdf', t=('x', -1, 5), ax=ax)
    >>> plt.plot(x, 2 * X.pdf(x), '--')
    >>> plt.legend(('PDF of `Y`', 'Doubled PDF of `X`'))
    >>> plt.show()

    """
    return FoldedDistribution(X)


def exp(X, /):
    r"""Natural exponential of a random variable

    Parameters
    ----------
    X : `ContinuousDistribution`
        The random variable :math:`X`.

    Returns
    -------
    Y : `ContinuousDistribution`
        A random variable :math:`Y = \exp(X)`.

    Examples
    --------
    Suppose we have a normally distributed random variable :math:`X`:

    >>> import numpy as np
    >>> from scipy import stats
    >>> X = stats.Normal()

    We wish to have a lognormally distributed random variable :math:`Y`,
    a random variable whose natural logarithm is :math:`X`.
    If :math:`X` is to be the natural logarithm of :math:`Y`, then we
    must take :math:`Y` to be the natural exponential of :math:`X`.

    >>> Y = stats.exp(X)

    To demonstrate that ``X`` represents the logarithm of ``Y``,
    we plot a normalized histogram of the logarithm of observations of
    ``Y`` against the PDF underlying ``X``.

    >>> import matplotlib.pyplot as plt
    >>> rng = np.random.default_rng(435383595582522)
    >>> y = Y.sample(shape=10000, rng=rng)
    >>> ax = plt.gca()
    >>> ax.hist(np.log(y), bins=50, density=True)
    >>> X.plot(ax=ax)
    >>> plt.legend(('PDF of `X`', 'histogram of `log(y)`'))
    >>> plt.show()

    """
    return MonotonicTransformedDistribution(X, g=np.exp, h=np.log, dh=lambda u: 1 / u,
                                            logdh=lambda u: -np.log(u))


def log(X, /):
    r"""Natural logarithm of a non-negative random variable

    Parameters
    ----------
    X : `ContinuousDistribution`
        The random variable :math:`X` with positive support.

    Returns
    -------
    Y : `ContinuousDistribution`
        A random variable :math:`Y = \exp(X)`.

    Examples
    --------
    Suppose we have a gamma distributed random variable :math:`X`:

    >>> import numpy as np
    >>> from scipy import stats
    >>> Gamma = stats.make_distribution(stats.gamma)
    >>> X = Gamma(a=1.0)

    We wish to have a exp-gamma distributed random variable :math:`Y`,
    a random variable whose natural exponential is :math:`X`.
    If :math:`X` is to be the natural exponential of :math:`Y`, then we
    must take :math:`Y` to be the natural logarithm of :math:`X`.

    >>> Y = stats.log(X)

    To demonstrate that ``X`` represents the exponential of ``Y``,
    we plot a normalized histogram of the exponential of observations of
    ``Y`` against the PDF underlying ``X``.

    >>> import matplotlib.pyplot as plt
    >>> rng = np.random.default_rng(435383595582522)
    >>> y = Y.sample(shape=10000, rng=rng)
    >>> ax = plt.gca()
    >>> ax.hist(np.exp(y), bins=50, density=True)
    >>> X.plot(ax=ax)
    >>> plt.legend(('PDF of `X`', 'histogram of `exp(y)`'))
    >>> plt.show()

    """
    if np.any(X.support()[0] < 0):
        message = ("The logarithm of a random variable is only implemented when the "
                   "support is non-negative.")
        raise NotImplementedError(message)
    return MonotonicTransformedDistribution(X, g=np.log, h=np.exp, dh=np.exp,
                                            logdh=lambda u: u)
