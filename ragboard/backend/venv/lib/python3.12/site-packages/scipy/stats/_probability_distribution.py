# Temporary file separated from _distribution_infrastructure.py
# to simplify the diff during PR review.
from abc import ABC, abstractmethod

class _ProbabilityDistribution(ABC):
    @abstractmethod
    def support(self):
        r"""Support of the random variable

        The support of a random variable is set of all possible outcomes;
        i.e., the subset of the domain of argument :math:`x` for which
        the probability density function :math:`f(x)` is nonzero.

        This function returns lower and upper bounds of the support.

        Returns
        -------
        out : tuple of Array
            The lower and upper bounds of the support.

        See Also
        --------
        pdf

        References
        ----------
        .. [1] Support (mathematics), *Wikipedia*,
               https://en.wikipedia.org/wiki/Support_(mathematics)

        Notes
        -----
        Suppose a continuous probability distribution has support ``(l, r)``.
        The following table summarizes the value returned by several
        methods when the argument is outside the support.

        +----------------+---------------------+---------------------+
        | Method         | Value for ``x < l`` | Value for ``x > r`` |
        +================+=====================+=====================+
        | ``pdf(x)``     | 0                   | 0                   |
        +----------------+---------------------+---------------------+
        | ``logpdf(x)``  | -inf                | -inf                |
        +----------------+---------------------+---------------------+
        | ``cdf(x)``     | 0                   | 1                   |
        +----------------+---------------------+---------------------+
        | ``logcdf(x)``  | -inf                | 0                   |
        +----------------+---------------------+---------------------+
        | ``ccdf(x)``    | 1                   | 0                   |
        +----------------+---------------------+---------------------+
        | ``logccdf(x)`` | 0                   | -inf                |
        +----------------+---------------------+---------------------+

        For discrete distributions, the same table is applicable with
        ``pmf`` and ``logpmf`` substituted for ``pdf`` and ``logpdf``.

        For the ``cdf`` and related methods of continuous distributions, the
        inequality need not be strict; i.e. the tabulated value is returned
        when the method is evaluated *at* the corresponding boundary.

        The following table summarizes the value returned by the inverse
        methods for arguments ``0`` and ``1``, whether the distribution
        is continuous or discrete.

        +-------------+-----------+-----------+
        | Method      | ``x = 0`` | ``x = 1`` |
        +=============+===========+===========+
        | ``icdf(x)`` | ``l``     | ``r``     |
        +-------------+-----------+-----------+
        | ``icdf(x)`` | ``r``     | ``l``     |
        +-------------+-----------+-----------+

        For the inverse log-functions, the same values are returned
        for ``x = log(0)`` and ``x = log(1)``. All inverse functions return
        ``nan`` when evaluated at an argument outside the domain ``0`` to ``1``.

        Examples
        --------
        Instantiate a distribution with the desired parameters:

        >>> from scipy import stats
        >>> X = stats.Uniform(a=-0.5, b=0.5)

        Retrieve the support of the distribution:

        >>> X.support()
        (-0.5, 0.5)

        For a distribution with infinite support,

        >>> X = stats.Normal()
        >>> X.support()
        (-inf, inf)

        Due to underflow, the numerical value returned by the PDF may be zero
        even for arguments within the support, even if the true value is
        nonzero. In such cases, the log-PDF may be useful.

        >>> X.pdf([-100., 100.])
        array([0., 0.])
        >>> X.logpdf([-100., 100.])
        array([-5000.91893853, -5000.91893853])

        Use cases for the log-CDF and related methods are analogous.

        """
        raise NotImplementedError()

    @abstractmethod
    def sample(self, shape, *, method, rng):
        r"""Random sample from the distribution.

        Parameters
        ----------
        shape : tuple of ints, default: ()
            The shape of the sample to draw. If the parameters of the distribution
            underlying the random variable are arrays of shape ``param_shape``,
            the output array will be of shape ``shape + param_shape``.
        method : {None, 'formula', 'inverse_transform'}
            The strategy used to produce the sample. By default (``None``),
            the infrastructure chooses between the following options,
            listed in order of precedence.

            - ``'formula'``: an implementation specific to the distribution
            - ``'inverse_transform'``: generate a uniformly distributed sample and
              return the inverse CDF at these arguments.

            Not all `method` options are available for all distributions.
            If the selected `method` is not available, a `NotImplementedError``
            will be raised.
        rng : `numpy.random.Generator` or `scipy.stats.QMCEngine`, optional
            Pseudo- or quasi-random number generator state. When `rng` is None,
            a new `numpy.random.Generator` is created using entropy from the
            operating system. Types other than `numpy.random.Generator` and
            `scipy.stats.QMCEngine` are passed to `numpy.random.default_rng`
            to instantiate a ``Generator``.

            If `rng` is an instance of `scipy.stats.QMCEngine` configured to use
            scrambling and `shape` is not empty, then each slice along the zeroth
            axis of the result is a "quasi-independent", low-discrepancy sequence;
            that is, they are distinct sequences that can be treated as statistically
            independent for most practical purposes. Separate calls to `sample`
            produce new quasi-independent, low-discrepancy sequences.

        References
        ----------
        .. [1] Sampling (statistics), *Wikipedia*,
               https://en.wikipedia.org/wiki/Sampling_(statistics)

        Examples
        --------
        Instantiate a distribution with the desired parameters:

        >>> import numpy as np
        >>> from scipy import stats
        >>> X = stats.Uniform(a=0., b=1.)

        Generate a pseudorandom sample:

        >>> x = X.sample((1000, 1))
        >>> octiles = (np.arange(8) + 1) / 8
        >>> np.count_nonzero(x <= octiles, axis=0)
        array([ 148,  263,  387,  516,  636,  751,  865, 1000])  # may vary

        >>> X = stats.Uniform(a=np.zeros((3, 1)), b=np.ones(2))
        >>> X.a.shape,
        (3, 2)
        >>> x = X.sample(shape=(5, 4))
        >>> x.shape
        (5, 4, 3, 2)

        """
        raise NotImplementedError()

    @abstractmethod
    def moment(self, order, kind, *, method):
        r"""Raw, central, or standard moment of positive integer order.

        In terms of probability density function :math:`f(x)` and support
        :math:`\chi`, the "raw" moment (about the origin) of order :math:`n` of
        a continuous random variable :math:`X` is:

        .. math::

            \mu'_n(X) = \int_{\chi} x^n f(x) dx

        The "central" moment is the raw moment taken about the mean,
        :math:`\mu = \mu'_1`:

        .. math::

            \mu_n(X) = \int_{\chi} (x - \mu) ^n f(x) dx

        The "standardized" moment is the central moment normalized by the
        :math:`n^\text{th}` power of the standard deviation
        :math:`\sigma = \sqrt{\mu_2}` to produce a scale invariant quantity:

        .. math::

            \tilde{\mu}_n(X) = \frac{\mu_n(X)}
                                    {\sigma^n}

        The definitions for discrete random variables are analogous, with
        sums over the support replacing the integrals.
        
        Parameters
        ----------
        order : int
            The integer order of the moment; i.e. :math:`n` in the formulae above.
        kind : {'raw', 'central', 'standardized'}
            Whether to return the raw (default), central, or standardized moment
            defined above.
        method : {None, 'formula', 'general', 'transform', 'normalize', 'quadrature', 'cache'}
            The strategy used to evaluate the moment. By default (``None``),
            the infrastructure chooses between the following options,
            listed in order of precedence.

            - ``'cache'``: use the value of the moment most recently calculated
              via another method
            - ``'formula'``: use a formula for the moment itself
            - ``'general'``: use a general result that is true for all distributions
              with finite moments; for instance, the zeroth raw moment is
              identically 1
            - ``'transform'``: transform a raw moment to a central moment or
              vice versa (see Notes)
            - ``'normalize'``: normalize a central moment to get a standardized
              or vice versa
            - ``'quadrature'``: numerically integrate (or, in the discrete case, sum)
              according to the definition

            Not all `method` options are available for all orders, kinds, and
            distributions. If the selected `method` is not available, a
            ``NotImplementedError`` will be raised.

        Returns
        -------
        out : array
            The moment of the random variable of the specified order and kind.

        See Also
        --------
        pdf
        mean
        variance
        standard_deviation
        skewness
        kurtosis

        Notes
        -----
        Not all distributions have finite moments of all orders; moments of some
        orders may be undefined or infinite. If a formula for the moment is not
        specifically implemented for the chosen distribution, SciPy will attempt
        to compute the moment via a generic method, which may yield a finite
        result where none exists. This is not a critical bug, but an opportunity
        for an enhancement.

        The definition of a raw moment in the summary is specific to the raw moment
        about the origin. The raw moment about any point :math:`a` is:

        .. math::

            E[(X-a)^n] = \int_{\chi} (x-a)^n f(x) dx

        In this notation, a raw moment about the origin is :math:`\mu'_n = E[x^n]`,
        and a central moment is :math:`\mu_n = E[(x-\mu)^n]`, where :math:`\mu`
        is the first raw moment; i.e. the mean.

        The ``'transform'`` method takes advantage of the following relationships
        between moments taken about different points :math:`a` and :math:`b`.

        .. math::

            E[(X-b)^n] =  \sum_{i=0}^n E[(X-a)^i] {n \choose i} (a - b)^{n-i}

        For instance, to transform the raw moment to the central moment, we let
        :math:`b = \mu` and :math:`a = 0`.

        The distribution infrastructure provides flexibility for distribution
        authors to implement separate formulas for raw moments, central moments,
        and standardized moments of any order. By default, the moment of the
        desired order and kind is evaluated from the formula if such a formula
        is available; if not, the infrastructure uses any formulas that are
        available rather than resorting directly to numerical integration.
        For instance, if formulas for the first three raw moments are
        available and the third standardized moments is desired, the
        infrastructure will evaluate the raw moments and perform the transforms
        and standardization required. The decision tree is somewhat complex,
        but the strategy for obtaining a moment of a given order and kind
        (possibly as an intermediate step due to the recursive nature of the
        transform formula above) roughly follows this order of priority:

        #. Use cache (if order of same moment and kind has been calculated)
        #. Use formula (if available)
        #. Transform between raw and central moment and/or normalize to convert
           between central and standardized moments (if efficient)
        #. Use a generic result true for most distributions (if available)
        #. Use quadrature

        References
        ----------
        .. [1] Moment, *Wikipedia*,
               https://en.wikipedia.org/wiki/Moment_(mathematics)

        Examples
        --------
        Instantiate a distribution with the desired parameters:

        >>> from scipy import stats
        >>> X = stats.Normal(mu=1., sigma=2.)

        Evaluate the first raw moment:

        >>> X.moment(order=1, kind='raw')
        1.0
        >>> X.moment(order=1, kind='raw') == X.mean() == X.mu
        True

        Evaluate the second central moment:

        >>> X.moment(order=2, kind='central')
        4.0
        >>> X.moment(order=2, kind='central') == X.variance() == X.sigma**2
        True

        Evaluate the fourth standardized moment:

        >>> X.moment(order=4, kind='standardized')
        3.0
        >>> X.moment(order=4, kind='standardized') == X.kurtosis(convention='non-excess')
        True

        """  # noqa:E501
        raise NotImplementedError()

    @abstractmethod
    def mean(self, *, method):
        r"""Mean (raw first moment about the origin)

        Parameters
        ----------
        method : {None, 'formula', 'transform', 'quadrature', 'cache'}
            Method used to calculate the raw first moment. Not
            all methods are available for all distributions. See
            `moment` for details.

        See Also
        --------
        moment
        median
        mode

        References
        ----------
        .. [1] Mean, *Wikipedia*,
               https://en.wikipedia.org/wiki/Mean#Mean_of_a_probability_distribution

        Examples
        --------
        Instantiate a distribution with the desired parameters:

        >>> from scipy import stats
        >>> X = stats.Normal(mu=1., sigma=2.)

        Evaluate the variance:

        >>> X.mean()
        1.0
        >>> X.mean() == X.moment(order=1, kind='raw') == X.mu
        True

        """
        raise NotImplementedError()

    @abstractmethod
    def median(self, *, method):
        r"""Median (50th percentile)

        If a continuous random variable :math:`X` has probability :math:`0.5` of
        taking on a value less than :math:`m`, then :math:`m` is the median.

        More generally, a median is a value :math:`m` for which:

        .. math::

            P(X ≤ m) ≤ 0.5 ≥ P(X ≥ m)

        For discrete random variables, the median may not be unique, in which
        case the smallest value satisfying the definition is reported.

        Parameters
        ----------
        method : {None, 'formula', 'icdf'}
            The strategy used to evaluate the median.
            By default (``None``), the infrastructure chooses between the
            following options, listed in order of precedence.

            - ``'formula'``: use a formula for the median
            - ``'icdf'``: evaluate the inverse CDF of 0.5

            Not all `method` options are available for all distributions.
            If the selected `method` is not available, a ``NotImplementedError``
            will be raised.

        Returns
        -------
        out : array
            The median

        See Also
        --------
        mean
        mode
        icdf

        References
        ----------
        .. [1] Median, *Wikipedia*,
               https://en.wikipedia.org/wiki/Median#Probability_distributions

        Examples
        --------
        Instantiate a distribution with the desired parameters:

        >>> from scipy import stats
        >>> X = stats.Uniform(a=0., b=10.)

        Compute the median:

        >>> X.median()
        np.float64(5.0)
        >>> X.median() == X.icdf(0.5) == X.iccdf(0.5)
        True

        """
        raise NotImplementedError()

    @abstractmethod
    def mode(self, *, method):
        r"""Mode (most likely value)

        Informally, the mode is a value that a random variable has the highest
        probability (density) of assuming. That is, the mode is the element of
        the support :math:`\chi` that maximizes the probability density (or mass,
        for discrete random variables) function :math:`f(x)`:

        .. math::

            \text{mode} = \arg\max_{x \in \chi} f(x)

        Parameters
        ----------
        method : {None, 'formula', 'optimization'}
            The strategy used to evaluate the mode.
            By default (``None``), the infrastructure chooses between the
            following options, listed in order of precedence.

            - ``'formula'``: use a formula for the median
            - ``'optimization'``: numerically maximize the PDF/PMF

            Not all `method` options are available for all distributions.
            If the selected `method` is not available, a ``NotImplementedError``
            will be raised.

        Returns
        -------
        out : array
            The mode

        See Also
        --------
        mean
        median
        pdf

        Notes
        -----
        For some distributions

        #. the mode is not unique (e.g. the uniform distribution);
        #. the PDF has one or more singularities, and it is debatable whether
           a singularity is considered to be in the domain and called the mode
           (e.g. the gamma distribution with shape parameter less than 1); and/or
        #. the probability density function may have one or more local maxima
           that are not a global maximum (e.g. mixture distributions).

        In such cases, `mode` will

        #. return a single value,
        #. consider the mode to occur at a singularity, and/or
        #. return a local maximum which may or may not be a global maximum.

        If a formula for the mode is not specifically implemented for the
        chosen distribution, SciPy will attempt to compute the mode
        numerically, which may not meet the user's preferred definition of a
        mode. In such cases, the user is encouraged to subclass the
        distribution and override ``mode``.

        References
        ----------
        .. [1] Mode (statistics), *Wikipedia*,
               https://en.wikipedia.org/wiki/Mode_(statistics)

        Examples
        --------
        Instantiate a distribution with the desired parameters:

        >>> from scipy import stats
        >>> X = stats.Normal(mu=1., sigma=2.)

        Evaluate the mode:

        >>> X.mode()
        1.0

        If the mode is not uniquely defined, ``mode`` nonetheless returns a
        single value.

        >>> X = stats.Uniform(a=0., b=1.)
        >>> X.mode()
        0.5

        If this choice does not satisfy your requirements, subclass the
        distribution and override ``mode``:

        >>> class BetterUniform(stats.Uniform):
        ...     def mode(self):
        ...         return self.b
        >>> X = BetterUniform(a=0., b=1.)
        >>> X.mode()
        1.0

        """
        raise NotImplementedError()

    @abstractmethod
    def variance(self, *, method):
        r"""Variance (central second moment)

        Parameters
        ----------
        method : {None, 'formula', 'transform', 'normalize', 'quadrature', 'cache'}
            Method used to calculate the central second moment. Not
            all methods are available for all distributions. See
            `moment` for details.

        See Also
        --------
        moment
        standard_deviation
        mean

        References
        ----------
        .. [1] Variance, *Wikipedia*,
               https://en.wikipedia.org/wiki/Variance#Absolutely_continuous_random_variable

        Examples
        --------
        Instantiate a distribution with the desired parameters:

        >>> from scipy import stats
        >>> X = stats.Normal(mu=1., sigma=2.)

        Evaluate the variance:

        >>> X.variance()
        4.0
        >>> X.variance() == X.moment(order=2, kind='central') == X.sigma**2
        True

        """
        raise NotImplementedError()

    @abstractmethod
    def standard_deviation(self, *, method):
        r"""Standard deviation (square root of the second central moment)

        Parameters
        ----------
        method : {None, 'formula', 'transform', 'normalize', 'quadrature', 'cache'}
            Method used to calculate the central second moment. Not
            all methods are available for all distributions. See
            `moment` for details.

        See Also
        --------
        variance
        mean
        moment

        References
        ----------
        .. [1] Standard deviation, *Wikipedia*,
               https://en.wikipedia.org/wiki/Standard_deviation#Definition_of_population_values

        Examples
        --------
        Instantiate a distribution with the desired parameters:

        >>> from scipy import stats
        >>> X = stats.Normal(mu=1., sigma=2.)

        Evaluate the standard deviation:

        >>> X.standard_deviation()
        2.0
        >>> X.standard_deviation() == X.moment(order=2, kind='central')**0.5 == X.sigma
        True

        """
        raise NotImplementedError()

    @abstractmethod
    def skewness(self, *, method):
        r"""Skewness (standardized third moment)

        Parameters
        ----------
        method : {None, 'formula', 'general', 'transform', 'normalize', 'cache'}
            Method used to calculate the standardized third moment. Not
            all methods are available for all distributions. See
            `moment` for details.

        See Also
        --------
        moment
        mean
        variance

        References
        ----------
        .. [1] Skewness, *Wikipedia*,
               https://en.wikipedia.org/wiki/Skewness

        Examples
        --------
        Instantiate a distribution with the desired parameters:

        >>> from scipy import stats
        >>> X = stats.Normal(mu=1., sigma=2.)

        Evaluate the skewness:

        >>> X.skewness()
        0.0
        >>> X.skewness() == X.moment(order=3, kind='standardized')
        True

        """
        raise NotImplementedError()

    @abstractmethod
    def kurtosis(self, *, method):
        r"""Kurtosis (standardized fourth moment)

        By default, this is the standardized fourth moment, also known as the
        "non-excess" or "Pearson" kurtosis (e.g. the kurtosis of the normal
        distribution is 3). The "excess" or "Fisher" kurtosis (the standardized
        fourth moment minus 3) is available via the `convention` parameter.

        Parameters
        ----------
        method : {None, 'formula', 'general', 'transform', 'normalize', 'cache'}
            Method used to calculate the standardized fourth moment. Not
            all methods are available for all distributions. See
            `moment` for details.
        convention : {'non-excess', 'excess'}
            Two distinct conventions are available:

            - ``'non-excess'``: the standardized fourth moment (Pearson's kurtosis)
            - ``'excess'``: the standardized fourth moment minus 3 (Fisher's kurtosis)

            The default is ``'non-excess'``.

        See Also
        --------
        moment
        mean
        variance

        References
        ----------
        .. [1] Kurtosis, *Wikipedia*,
               https://en.wikipedia.org/wiki/Kurtosis

        Examples
        --------
        Instantiate a distribution with the desired parameters:

        >>> from scipy import stats
        >>> X = stats.Normal(mu=1., sigma=2.)

        Evaluate the kurtosis:

        >>> X.kurtosis()
        3.0
        >>> (X.kurtosis()
        ...  == X.kurtosis(convention='excess') + 3.
        ...  == X.moment(order=4, kind='standardized'))
        True

        """
        raise NotImplementedError()

    @abstractmethod
    def pdf(self, x, /, *, method):
        r"""Probability density function

        The probability density function ("PDF"), denoted :math:`f(x)`, is the
        probability *per unit length* that the random variable will assume the
        value :math:`x`. Mathematically, it can be defined as the derivative
        of the cumulative distribution function :math:`F(x)`:

        .. math::

            f(x) = \frac{d}{dx} F(x)

        `pdf` accepts `x` for :math:`x`.

        Parameters
        ----------
        x : array_like
            The argument of the PDF.
        method : {None, 'formula', 'logexp'}
            The strategy used to evaluate the PDF. By default (``None``), the
            infrastructure chooses between the following options, listed in
            order of precedence.

            - ``'formula'``: use a formula for the PDF itself
            - ``'logexp'``: evaluate the log-PDF and exponentiate

            Not all `method` options are available for all distributions.
            If the selected `method` is not available, a ``NotImplementedError``
            will be raised.

        Returns
        -------
        out : array
            The PDF evaluated at the argument `x`.

        See Also
        --------
        cdf
        logpdf

        Notes
        -----
        Suppose a continuous probability distribution has support :math:`[l, r]`.
        By definition of the support, the PDF evaluates to its minimum value
        of :math:`0` outside the support; i.e. for :math:`x < l` or
        :math:`x > r`. The maximum of the PDF may be less than or greater than
        :math:`1`; since the value is a probability *density*, only its integral
        over the support must equal :math:`1`.

        For discrete distributions, `pdf` returns ``inf`` at supported points
        and ``0`` elsewhere.

        References
        ----------
        .. [1] Probability density function, *Wikipedia*,
               https://en.wikipedia.org/wiki/Probability_density_function

        Examples
        --------
        Instantiate a distribution with the desired parameters:

        >>> from scipy import stats
        >>> X = stats.Uniform(a=-1., b=1.)

        Evaluate the PDF at the desired argument:

        >>> X.pdf(0.25)
        0.5

        """
        raise NotImplementedError()

    @abstractmethod
    def logpdf(self, x, /, *, method):
        r"""Log of the probability density function

        The probability density function ("PDF"), denoted :math:`f(x)`, is the
        probability *per unit length* that the random variable will assume the
        value :math:`x`. Mathematically, it can be defined as the derivative
        of the cumulative distribution function :math:`F(x)`:

        .. math::

            f(x) = \frac{d}{dx} F(x)

        `logpdf` computes the logarithm of the probability density function
        ("log-PDF"), :math:`\log(f(x))`, but it may be numerically favorable
        compared to the naive implementation (computing :math:`f(x)` and
        taking the logarithm).

        `logpdf` accepts `x` for :math:`x`.

        Parameters
        ----------
        x : array_like
            The argument of the log-PDF.
        method : {None, 'formula', 'logexp'}
            The strategy used to evaluate the log-PDF. By default (``None``), the
            infrastructure chooses between the following options, listed in order
            of precedence.

            - ``'formula'``: use a formula for the log-PDF itself
            - ``'logexp'``: evaluate the PDF and takes its logarithm

            Not all `method` options are available for all distributions.
            If the selected `method` is not available, a ``NotImplementedError``
            will be raised.

        Returns
        -------
        out : array
            The log-PDF evaluated at the argument `x`.

        See Also
        --------
        pdf
        logcdf

        Notes
        -----
        Suppose a continuous probability distribution has support :math:`[l, r]`.
        By definition of the support, the log-PDF evaluates to its minimum value
        of :math:`-\infty` (i.e. :math:`\log(0)`) outside the support; i.e. for
        :math:`x < l` or :math:`x > r`. The maximum of the log-PDF may be less
        than or greater than :math:`\log(1) = 0` because the maximum of the PDF
        can be any positive real.

        For distributions with infinite support, it is common for `pdf` to return
        a value of ``0`` when the argument is theoretically within the support;
        this can occur because the true value of the PDF is too small to be
        represented by the chosen dtype. The log-PDF, however, will often be finite
        (not ``-inf``) over a much larger domain. Consequently, it may be preferred
        to work with the logarithms of probabilities and probability densities to
        avoid underflow.

        For discrete distributions, `logpdf` returns ``inf`` at supported points and
        ``-inf`` (``log(0)``) elsewhere.

        References
        ----------
        .. [1] Probability density function, *Wikipedia*,
               https://en.wikipedia.org/wiki/Probability_density_function

        Examples
        --------
        Instantiate a distribution with the desired parameters:

        >>> import numpy as np
        >>> from scipy import stats
        >>> X = stats.Uniform(a=-1.0, b=1.0)

        Evaluate the log-PDF at the desired argument:

        >>> X.logpdf(0.5)
        -0.6931471805599453
        >>> np.allclose(X.logpdf(0.5), np.log(X.pdf(0.5)))
        True

        """
        raise NotImplementedError()

    def pmf(self, x, /, *, method=None):
        r"""Probability mass function

        The probability mass function ("PMF"), denoted :math:`f(x)`, is the
        probability that the random variable :math:`X` will assume the value :math:`x`.

        .. math::

            f(x) = P(X = x)

        `pmf` accepts `x` for :math:`x`.

        Parameters
        ----------
        x : array_like
            The argument of the PMF.
        method : {None, 'formula', 'logexp'}
            The strategy used to evaluate the PMF. By default (``None``), the
            infrastructure chooses between the following options, listed in
            order of precedence.

            - ``'formula'``: use a formula for the PMF itself
            - ``'logexp'``: evaluate the log-PMF and exponentiate

            Not all `method` options are available for all distributions.
            If the selected `method` is not available, a ``NotImplementedError``
            will be raised.

        Returns
        -------
        out : array
            The PMF evaluated at the argument `x`.

        See Also
        --------
        cdf
        logpmf

        Notes
        -----
        Suppose a discrete probability distribution has support over the integers
        :math:`{l, l+1, ..., r-1, r}`.
        By definition of the support, the PMF evaluates to its minimum value
        of :math:`0` for non-integral :math:`x` and for :math:`x` outside the support;
        i.e. for :math:`x < l` or :math:`x > r`.

        For continuous distributions, `pmf` returns ``0`` at all real arguments.

        References
        ----------
        .. [1] Probability mass function, *Wikipedia*,
               https://en.wikipedia.org/wiki/Probability_mass_function

        Examples
        --------
        Instantiate a distribution with the desired parameters:

        >>> from scipy import stats
        >>> X = stats.Binomial(n=10, p=0.5)

        Evaluate the PMF at the desired argument:

        >>> X.pmf(5)
        np.float64(0.24609375)

        """
        raise NotImplementedError()

    def logpmf(self, x, /, *, method=None):
        r"""Log of the probability mass function

        The probability mass function ("PMF"), denoted :math:`f(x)`, is the
        probability that the random variable :math:`X` will assume the value :math:`x`.

        .. math::

            f(x) = \frac{d}{dx} F(x)

        `logpmf` computes the logarithm of the probability mass function
        ("log-PMF"), :math:`\log(f(x))`, but it may be numerically favorable
        compared to the naive implementation (computing :math:`f(x)` and
        taking the logarithm).

        `logpmf` accepts `x` for :math:`x`.

        Parameters
        ----------
        x : array_like
            The argument of the log-PMF.
        method : {None, 'formula', 'logexp'}
            The strategy used to evaluate the log-PMF. By default (``None``), the
            infrastructure chooses between the following options, listed in order
            of precedence.

            - ``'formula'``: use a formula for the log-PMF itself
            - ``'logexp'``: evaluate the PMF and takes its logarithm

            Not all `method` options are available for all distributions.
            If the selected `method` is not available, a ``NotImplementedError``
            will be raised.

        Returns
        -------
        out : array
            The log-PMF evaluated at the argument `x`.

        See Also
        --------
        pmf
        logcdf

        Notes
        -----
        Suppose a discrete probability distribution has support over the integers
        :math:`{l, l+1, ..., r-1, r}`.
        By definition of the support, the log-PMF evaluates to its minimum value
        of :math:`-\infty` (i.e. :math:`\log(0)`) for non-integral :math:`x` and
        for :math:`x` outside the support; i.e. for :math:`x < l` or :math:`x > r`.

        For distributions with infinite support, it is common for `pmf` to return
        a value of ``0`` when the argument is theoretically within the support;
        this can occur because the true value of the PMF is too small to be
        represented by the chosen dtype. The log-PMF, however, will often be finite
        (not ``-inf``) over a much larger domain. Consequently, it may be preferred
        to work with the logarithms of probabilities and probability densities to
        avoid underflow.

        References
        ----------
        .. [1] Probability density function, *Wikipedia*,
               https://en.wikipedia.org/wiki/Probability_density_function

        Examples
        --------
        Instantiate a distribution with the desired parameters:

        >>> import numpy as np
        >>> from scipy import stats
        >>> X = stats.Binomial(n=10, p=0.5)

        Evaluate the log-PMF at the desired argument:

        >>> X.logpmf(5)
        np.float64(-1.4020427180880297)
        >>> np.allclose(X.logpmf(5), np.log(X.pmf(5)))
        True

        """
        raise NotImplementedError()

    @abstractmethod
    def cdf(self, x, y, /, *, method):
        r"""Cumulative distribution function

        The cumulative distribution function ("CDF"), denoted :math:`F(x)`, is
        the probability the random variable :math:`X` will assume a value
        less than or equal to :math:`x`:

        .. math::

            F(x) = P(X ≤ x)

        A two-argument variant of this function is also defined as the
        probability the random variable :math:`X` will assume a value between
        :math:`x` and :math:`y`.

        .. math::

            F(x, y) = P(x ≤ X ≤ y)

        `cdf` accepts `x` for :math:`x` and `y` for :math:`y`.

        Parameters
        ----------
        x, y : array_like
            The arguments of the CDF. `x` is required; `y` is optional.
        method : {None, 'formula', 'logexp', 'complement', 'quadrature', 'subtraction'}
            The strategy used to evaluate the CDF.
            By default (``None``), the one-argument form of the function
            chooses between the following options, listed in order of precedence.

            - ``'formula'``: use a formula for the CDF itself
            - ``'logexp'``: evaluate the log-CDF and exponentiate
            - ``'complement'``: evaluate the CCDF and take the complement
            - ``'quadrature'``: numerically integrate the PDF (or, in the discrete
              case, sum the PMF)

            In place of ``'complement'``, the two-argument form accepts:

            - ``'subtraction'``: compute the CDF at each argument and take
              the difference.

            Not all `method` options are available for all distributions.
            If the selected `method` is not available, a ``NotImplementedError``
            will be raised.

        Returns
        -------
        out : array
            The CDF evaluated at the provided argument(s).

        See Also
        --------
        logcdf
        ccdf

        Notes
        -----
        Suppose a continuous probability distribution has support :math:`[l, r]`.
        The CDF :math:`F(x)` is related to the probability density function
        :math:`f(x)` by:

        .. math::

            F(x) = \int_l^x f(u) du

        The two argument version is:

        .. math::

            F(x, y) = \int_x^y f(u) du = F(y) - F(x)

        The CDF evaluates to its minimum value of :math:`0` for :math:`x ≤ l`
        and its maximum value of :math:`1` for :math:`x ≥ r`.

        Suppose a discrete probability distribution has support :math:`[l, r]`.
        The CDF :math:`F(x)` is related to the probability mass function
        :math:`f(x)` by:

        .. math::

            F(x) = \sum_{u=l}^{\lfloor x \rfloor} f(u)

        The CDF evaluates to its minimum value of :math:`0` for :math:`x < l`
        and its maximum value of :math:`1` for :math:`x ≥ r`.
        
        The CDF is also known simply as the "distribution function".

        References
        ----------
        .. [1] Cumulative distribution function, *Wikipedia*,
               https://en.wikipedia.org/wiki/Cumulative_distribution_function

        Examples
        --------
        Instantiate a distribution with the desired parameters:

        >>> from scipy import stats
        >>> X = stats.Uniform(a=-0.5, b=0.5)

        Evaluate the CDF at the desired argument:

        >>> X.cdf(0.25)
        0.75

        Evaluate the cumulative probability between two arguments:

        >>> X.cdf(-0.25, 0.25) == X.cdf(0.25) - X.cdf(-0.25)
        True

        """  # noqa: E501
        raise NotImplementedError()

    @abstractmethod
    def icdf(self, p, /, *, method):
        r"""Inverse of the cumulative distribution function.

        For monotonic continuous distributions, the inverse of the cumulative
        distribution function ("inverse CDF"), denoted :math:`F^{-1}(p)`, is the
        argument :math:`x` for which the cumulative distribution function
        :math:`F(x)` evaluates to :math:`p`.

        .. math::

            F^{-1}(p) = x \quad \text{s.t.} \quad F(x) = p

        When a strict "inverse" of the cumulative distribution function does not
        exist (e.g. discrete random variables), the "inverse CDF" is defined by
        convention as the smallest value within the support :math:`\chi` for which
        :math:`F(x)` is at least :math:`p`.

        .. math::

            F^{-1}(p) = \min_\chi \quad \text{s.t.} \quad F(x) ≥ p

        `icdf` accepts `p` for :math:`p \in [0, 1]`.

        Parameters
        ----------
        p : array_like
            The argument of the inverse CDF.
        method : {None, 'formula', 'complement', 'inversion'}
            The strategy used to evaluate the inverse CDF.
            By default (``None``), the infrastructure chooses between the
            following options, listed in order of precedence.

            - ``'formula'``: use a formula for the inverse CDF itself
            - ``'complement'``: evaluate the inverse CCDF at the
              complement of `p`
            - ``'inversion'``: solve numerically for the argument at which the
              CDF is equal to `p`

            Not all `method` options are available for all distributions.
            If the selected `method` is not available, a ``NotImplementedError``
            will be raised.

        Returns
        -------
        out : array
            The inverse CDF evaluated at the provided argument.

        See Also
        --------
        cdf
        ilogcdf

        Notes
        -----
        Suppose a probability distribution has support :math:`[l, r]`. The
        inverse CDF returns its minimum value of :math:`l` at :math:`p = 0`
        and its maximum value of :math:`r` at :math:`p = 1`. Because the CDF
        has range :math:`[0, 1]`, the inverse CDF is only defined on the
        domain :math:`[0, 1]`; for :math:`p < 0` and :math:`p > 1`, `icdf`
        returns ``nan``.

        The inverse CDF is also known as the quantile function, percentile function,
        and percent-point function.

        References
        ----------
        .. [1] Quantile function, *Wikipedia*,
               https://en.wikipedia.org/wiki/Quantile_function

        Examples
        --------
        Instantiate a distribution with the desired parameters:

        >>> import numpy as np
        >>> from scipy import stats
        >>> X = stats.Uniform(a=-0.5, b=0.5)

        Evaluate the inverse CDF at the desired argument:

        >>> X.icdf(0.25)
        -0.25
        >>> np.allclose(X.cdf(X.icdf(0.25)), 0.25)
        True

        This function returns NaN when the argument is outside the domain.

        >>> X.icdf([-0.1, 0, 1, 1.1])
        array([ nan, -0.5,  0.5,  nan])

        """
        raise NotImplementedError()

    @abstractmethod
    def ccdf(self, x, y, /, *, method):
        r"""Complementary cumulative distribution function

        The complementary cumulative distribution function ("CCDF"), denoted
        :math:`G(x)`, is the complement of the cumulative distribution function
        :math:`F(x)`; i.e., probability the random variable :math:`X` will
        assume a value greater than :math:`x`:

        .. math::

            G(x) = 1 - F(x) = P(X > x)

        A two-argument variant of this function is:

        .. math::

            G(x, y) = 1 - F(x, y) = P(X < x \text{ or } X > y)

        `ccdf` accepts `x` for :math:`x` and `y` for :math:`y`.

        Parameters
        ----------
        x, y : array_like
            The arguments of the CCDF. `x` is required; `y` is optional.
        method : {None, 'formula', 'logexp', 'complement', 'quadrature', 'addition'}
            The strategy used to evaluate the CCDF.
            By default (``None``), the infrastructure chooses between the
            following options, listed in order of precedence.

            - ``'formula'``: use a formula for the CCDF itself
            - ``'logexp'``: evaluate the log-CCDF and exponentiate
            - ``'complement'``: evaluate the CDF and take the complement
            - ``'quadrature'``: numerically integrate the PDF (or, in the discrete
              case, sum the PMF)

            The two-argument form chooses between:

            - ``'formula'``: use a formula for the CCDF itself
            - ``'addition'``: compute the CDF at `x` and the CCDF at `y`, then add

            Not all `method` options are available for all distributions.
            If the selected `method` is not available, a ``NotImplementedError``
            will be raised.

        Returns
        -------
        out : array
            The CCDF evaluated at the provided argument(s).

        See Also
        --------
        cdf
        logccdf

        Notes
        -----
        Suppose a continuous probability distribution has support :math:`[l, r]`.
        The CCDF :math:`G(x)` is related to the probability density function
        :math:`f(x)` by:

        .. math::

            G(x) = \int_x^r f(u) du

        The two argument version is:

        .. math::

            G(x, y) = \int_l^x f(u) du + \int_y^r f(u) du

        The CCDF returns its minimum value of :math:`0` for :math:`x ≥ r`
        and its maximum value of :math:`1` for :math:`x ≤ l`.

        Suppose a discrete probability distribution has support :math:`[l, r]`.
        The CCDF :math:`G(x)` is related to the probability mass function
        :math:`f(x)` by:

        .. math::

            G(x) = \sum_{u=\lfloor x + 1 \rfloor}^{r} f(u)

        The CCDF evaluates to its minimum value of :math:`0` for :math:`x ≥ r`
        and its maximum value of :math:`1` for :math:`x < l`.
        
        The CCDF is also known as the "survival function".

        References
        ----------
        .. [1] Cumulative distribution function, *Wikipedia*,
               https://en.wikipedia.org/wiki/Cumulative_distribution_function#Derived_functions

        Examples
        --------
        Instantiate a distribution with the desired parameters:

        >>> import numpy as np
        >>> from scipy import stats
        >>> X = stats.Uniform(a=-0.5, b=0.5)

        Evaluate the CCDF at the desired argument:

        >>> X.ccdf(0.25)
        0.25
        >>> np.allclose(X.ccdf(0.25), 1-X.cdf(0.25))
        True

        Evaluate the complement of the cumulative probability between two arguments:

        >>> X.ccdf(-0.25, 0.25) == X.cdf(-0.25) + X.ccdf(0.25)
        True

        """  # noqa: E501
        raise NotImplementedError()

    @abstractmethod
    def iccdf(self, p, /, *, method):
        r"""Inverse complementary cumulative distribution function.

        The inverse complementary cumulative distribution function ("inverse CCDF"),
        denoted :math:`G^{-1}(p)`, is the argument :math:`x` for which the
        complementary cumulative distribution function :math:`G(x)` evaluates to
        :math:`p`.

        .. math::

            G^{-1}(p) = x \quad \text{s.t.} \quad G(x) = p

        When a strict "inverse" of the complementary cumulative distribution function
        does not exist (e.g. discrete random variables), the "inverse CCDF" is defined
        by convention as the smallest value within the support :math:`\chi` for which
        :math:`G(x)` is no greater than :math:`p`.

        .. math::

            G^{-1}(p) = \min_\chi \quad \text{s.t.} \quad G(x) ≤ p

        `iccdf` accepts `p` for :math:`p \in [0, 1]`.

        Parameters
        ----------
        p : array_like
            The argument of the inverse CCDF.
        method : {None, 'formula', 'complement', 'inversion'}
            The strategy used to evaluate the inverse CCDF.
            By default (``None``), the infrastructure chooses between the
            following options, listed in order of precedence.

            - ``'formula'``: use a formula for the inverse CCDF itself
            - ``'complement'``: evaluate the inverse CDF at the
              complement of `p`
            - ``'inversion'``: solve numerically for the argument at which the
              CCDF is equal to `p`

            Not all `method` options are available for all distributions.
            If the selected `method` is not available, a ``NotImplementedError``
            will be raised.

        Returns
        -------
        out : array
            The inverse CCDF evaluated at the provided argument.

        Notes
        -----
        Suppose a probability distribution has support :math:`[l, r]`. The
        inverse CCDF returns its minimum value of :math:`l` at :math:`p = 1`
        and its maximum value of :math:`r` at :math:`p = 0`. Because the CCDF
        has range :math:`[0, 1]`, the inverse CCDF is only defined on the
        domain :math:`[0, 1]`; for :math:`p < 0` and :math:`p > 1`, ``iccdf``
        returns ``nan``.

        See Also
        --------
        icdf
        ilogccdf

        Examples
        --------
        Instantiate a distribution with the desired parameters:

        >>> import numpy as np
        >>> from scipy import stats
        >>> X = stats.Uniform(a=-0.5, b=0.5)

        Evaluate the inverse CCDF at the desired argument:

        >>> X.iccdf(0.25)
        0.25
        >>> np.allclose(X.iccdf(0.25), X.icdf(1-0.25))
        True

        This function returns NaN when the argument is outside the domain.

        >>> X.iccdf([-0.1, 0, 1, 1.1])
        array([ nan,  0.5, -0.5,  nan])

        """
        raise NotImplementedError()

    @abstractmethod
    def logcdf(self, x, y, /, *, method):
        r"""Log of the cumulative distribution function

        The cumulative distribution function ("CDF"), denoted :math:`F(x)`, is
        the probability the random variable :math:`X` will assume a value
        less than or equal to :math:`x`:

        .. math::

            F(x) = P(X ≤ x)

        A two-argument variant of this function is also defined as the
        probability the random variable :math:`X` will assume a value between
        :math:`x` and :math:`y`.

        .. math::

            F(x, y) = P(x ≤ X ≤ y)

        `logcdf` computes the logarithm of the cumulative distribution function
        ("log-CDF"), :math:`\log(F(x))`/:math:`\log(F(x, y))`, but it may be
        numerically favorable compared to the naive implementation (computing
        the CDF and taking the logarithm).

        `logcdf` accepts `x` for :math:`x` and `y` for :math:`y`.

        Parameters
        ----------
        x, y : array_like
            The arguments of the log-CDF. `x` is required; `y` is optional.
        method : {None, 'formula', 'logexp', 'complement', 'quadrature', 'subtraction'}
            The strategy used to evaluate the log-CDF.
            By default (``None``), the one-argument form of the function
            chooses between the following options, listed in order of precedence.

            - ``'formula'``: use a formula for the log-CDF itself
            - ``'logexp'``: evaluate the CDF and take the logarithm
            - ``'complement'``: evaluate the log-CCDF and take the
              logarithmic complement (see Notes)
            - ``'quadrature'``: numerically log-integrate the log-PDF (or, in the
              discrete case, log-sum the log-PMF)

            In place of ``'complement'``, the two-argument form accepts:

            - ``'subtraction'``: compute the log-CDF at each argument and take
              the logarithmic difference (see Notes)

            Not all `method` options are available for all distributions.
            If the selected `method` is not available, a ``NotImplementedError``
            will be raised.

        Returns
        -------
        out : array
            The log-CDF evaluated at the provided argument(s).

        See Also
        --------
        cdf
        logccdf

        Notes
        -----
        Suppose a continuous probability distribution has support :math:`[l, r]`.
        The log-CDF evaluates to its minimum value of :math:`\log(0) = -\infty`
        for :math:`x ≤ l` and its maximum value of :math:`\log(1) = 0` for
        :math:`x ≥ r`. An analogous statement can be made for discrete distributions,
        but the inequality governing the minimum value is strict.

        For distributions with infinite support, it is common for
        `cdf` to return a value of ``0`` when the argument
        is theoretically within the support; this can occur because the true value
        of the CDF is too small to be represented by the chosen dtype. `logcdf`,
        however, will often return a finite (not ``-inf``) result over a much larger
        domain. Similarly, `logcdf` may provided a strictly negative result with
        arguments for which `cdf` would return ``1.0``. Consequently, it may be
        preferred to work with the logarithms of probabilities to avoid underflow
        and related limitations of floating point numbers.

        The "logarithmic complement" of a number :math:`z` is mathematically
        equivalent to :math:`\log(1-\exp(z))`, but it is computed to avoid loss
        of precision when :math:`\exp(z)` is nearly :math:`0` or :math:`1`.
        Similarly, the term "logarithmic difference" of :math:`w` and :math:`z`
        is used here to mean :math:`\log(\exp(w)-\exp(z))`.

        If ``y < x``, the CDF is negative, and therefore the log-CCDF
        is complex with imaginary part :math:`\pi`. For
        consistency, the result of this function always has complex dtype
        when `y` is provided, regardless of the value of the imaginary part.

        References
        ----------
        .. [1] Cumulative distribution function, *Wikipedia*,
               https://en.wikipedia.org/wiki/Cumulative_distribution_function

        Examples
        --------
        Instantiate a distribution with the desired parameters:

        >>> import numpy as np
        >>> from scipy import stats
        >>> X = stats.Uniform(a=-0.5, b=0.5)

        Evaluate the log-CDF at the desired argument:

        >>> X.logcdf(0.25)
        -0.287682072451781
        >>> np.allclose(X.logcdf(0.), np.log(X.cdf(0.)))
        True

        """  # noqa: E501
        raise NotImplementedError()

    @abstractmethod
    def ilogcdf(self, logp, /, *, method):
        r"""Inverse of the logarithm of the cumulative distribution function.

        The inverse of the logarithm of the cumulative distribution function
        ("inverse log-CDF") is the argument :math:`x` for which the logarithm
        of the cumulative distribution function :math:`\log(F(x))` evaluates
        to :math:`\log(p)`.

        Mathematically, it is equivalent to :math:`F^{-1}(\exp(y))`, where
        :math:`y = \log(p)`, but it may be numerically favorable compared to
        the naive implementation (computing :math:`p = \exp(y)`, then
        :math:`F^{-1}(p)`).

        `ilogcdf` accepts `logp` for :math:`\log(p) ≤ 0`.

        Parameters
        ----------
        logp : array_like
            The argument of the inverse log-CDF.
        method : {None, 'formula', 'complement', 'inversion'}
            The strategy used to evaluate the inverse log-CDF.
            By default (``None``), the infrastructure chooses between the
            following options, listed in order of precedence.

            - ``'formula'``: use a formula for the inverse log-CDF itself
            - ``'complement'``: evaluate the inverse log-CCDF at the
              logarithmic complement of `logp` (see Notes)
            - ``'inversion'``: solve numerically for the argument at which the
              log-CDF is equal to `logp`

            Not all `method` options are available for all distributions.
            If the selected `method` is not available, a ``NotImplementedError``
            will be raised.

        Returns
        -------
        out : array
            The inverse log-CDF evaluated at the provided argument.

        See Also
        --------
        icdf
        logcdf

        Notes
        -----
        Suppose a probability distribution has support :math:`[l, r]`.
        The inverse log-CDF returns its minimum value of :math:`l` at
        :math:`\log(p) = \log(0) = -\infty` and its maximum value of :math:`r` at
        :math:`\log(p) = \log(1) = 0`. Because the log-CDF has range
        :math:`[-\infty, 0]`, the inverse log-CDF is only defined on the
        negative reals; for :math:`\log(p) > 0`, `ilogcdf` returns ``nan``.

        Occasionally, it is needed to find the argument of the CDF for which
        the resulting probability is very close to ``0`` or ``1`` - too close to
        represent accurately with floating point arithmetic. In many cases,
        however, the *logarithm* of this resulting probability may be
        represented in floating point arithmetic, in which case this function
        may be used to find the argument of the CDF for which the *logarithm*
        of the resulting probability is :math:`y = \log(p)`.

        The "logarithmic complement" of a number :math:`z` is mathematically
        equivalent to :math:`\log(1-\exp(z))`, but it is computed to avoid loss
        of precision when :math:`\exp(z)` is nearly :math:`0` or :math:`1`.

        Examples
        --------
        Instantiate a distribution with the desired parameters:

        >>> import numpy as np
        >>> from scipy import stats
        >>> X = stats.Uniform(a=-0.5, b=0.5)

        Evaluate the inverse log-CDF at the desired argument:

        >>> X.ilogcdf(-0.25)
        0.2788007830714034
        >>> np.allclose(X.ilogcdf(-0.25), X.icdf(np.exp(-0.25)))
        True

        """
        raise NotImplementedError()

    @abstractmethod
    def logccdf(self, x, y, /, *, method):
        r"""Log of the complementary cumulative distribution function

        The complementary cumulative distribution function ("CCDF"), denoted
        :math:`G(x)` is the complement of the cumulative distribution function
        :math:`F(x)`; i.e., probability the random variable :math:`X` will
        assume a value greater than :math:`x`:

        .. math::

            G(x) = 1 - F(x) = P(X > x)

         A two-argument variant of this function is:

        .. math::

            G(x, y) = 1 - F(x, y) = P(X < x \quad \text{or} \quad X > y)

        `logccdf` computes the logarithm of the complementary cumulative
        distribution function ("log-CCDF"), :math:`\log(G(x))`/:math:`\log(G(x, y))`,
        but it may be numerically favorable compared to the naive implementation
        (computing the CDF and taking the logarithm).

        `logccdf` accepts `x` for :math:`x` and `y` for :math:`y`.

        Parameters
        ----------
        x, y : array_like
            The arguments of the log-CCDF. `x` is required; `y` is optional.
        method : {None, 'formula', 'logexp', 'complement', 'quadrature', 'addition'}
            The strategy used to evaluate the log-CCDF.
            By default (``None``), the one-argument form of the function
            chooses between the following options, listed in order of precedence.

            - ``'formula'``: use a formula for the log CCDF itself
            - ``'logexp'``: evaluate the CCDF and take the logarithm
            - ``'complement'``: evaluate the log-CDF and take the
              logarithmic complement (see Notes)
            - ``'quadrature'``: numerically log-integrate the log-PDF (or, in the
              discrete case, log-sum the log-PMF)

            The two-argument form chooses between:

            - ``'formula'``: use a formula for the log CCDF itself
            - ``'addition'``: compute the log-CDF at `x` and the log-CCDF at `y`,
              then take the logarithmic sum (see Notes)

            Not all `method` options are available for all distributions.
            If the selected `method` is not available, a ``NotImplementedError``
            will be raised.

        Returns
        -------
        out : array
            The log-CCDF evaluated at the provided argument(s).

        See Also
        --------
        ccdf
        logcdf

        Notes
        -----
        Suppose a continuous probability distribution has support :math:`[l, r]`.
        The log-CCDF returns its minimum value of :math:`\log(0)=-\infty` for
        :math:`x ≥ r` and its maximum value of :math:`\log(1) = 0` for
        :math:`x ≤ l`. An analogous statement can be made for discrete distributions,
        but the inequality governing the maximum value is strict.

        For distributions with infinite support, it is common for
        `ccdf` to return a value of ``0`` when the argument
        is theoretically within the support; this can occur because the true value
        of the CCDF is too small to be represented by the chosen dtype. The log
        of the CCDF, however, will often be finite (not ``-inf``) over a much larger
        domain. Similarly, `logccdf` may provided a strictly negative result with
        arguments for which `ccdf` would return ``1.0``. Consequently, it may be
        preferred to work with the logarithms of probabilities to avoid underflow
        and related limitations of floating point numbers.

        The "logarithmic complement" of a number :math:`z` is mathematically
        equivalent to :math:`\log(1-\exp(z))`, but it is computed to avoid loss
        of precision when :math:`\exp(z)` is nearly :math:`0` or :math:`1`.
        Similarly, the term "logarithmic sum" of :math:`w` and :math:`z`
        is used here to mean the :math:`\log(\exp(w)+\exp(z))`, AKA
        :math:`\text{LogSumExp}(w, z)`.

        References
        ----------
        .. [1] Cumulative distribution function, *Wikipedia*,
               https://en.wikipedia.org/wiki/Cumulative_distribution_function#Derived_functions

        Examples
        --------
        Instantiate a distribution with the desired parameters:

        >>> import numpy as np
        >>> from scipy import stats
        >>> X = stats.Uniform(a=-0.5, b=0.5)

        Evaluate the log-CCDF at the desired argument:

        >>> X.logccdf(0.25)
        -1.3862943611198906
        >>> np.allclose(X.logccdf(0.), np.log(X.ccdf(0.)))
        True

        """  # noqa: E501
        raise NotImplementedError()

    @abstractmethod
    def ilogccdf(self, logp, /, *, method):
        r"""Inverse of the log of the complementary cumulative distribution function.

        The inverse of the logarithm of the complementary cumulative distribution
        function ("inverse log-CCDF") is the argument :math:`x` for which the logarithm
        of the complementary cumulative distribution function :math:`\log(G(x))`
        evaluates to :math:`\log(p)`.

        Mathematically, it is equivalent to :math:`G^{-1}(\exp(y))`, where
        :math:`y = \log(p)`, but it may be numerically favorable compared to the naive
        implementation (computing :math:`p = \exp(y)`, then :math:`G^{-1}(p)`).

        `ilogccdf` accepts `logp` for :math:`\log(p) ≤ 0`.

        Parameters
        ----------
        x : array_like
            The argument of the inverse log-CCDF.
        method : {None, 'formula', 'complement', 'inversion'}
            The strategy used to evaluate the inverse log-CCDF.
            By default (``None``), the infrastructure chooses between the
            following options, listed in order of precedence.

            - ``'formula'``: use a formula for the inverse log-CCDF itself
            - ``'complement'``: evaluate the inverse log-CDF at the
              logarithmic complement of `x` (see Notes)
            - ``'inversion'``: solve numerically for the argument at which the
              log-CCDF is equal to `x`

            Not all `method` options are available for all distributions.
            If the selected `method` is not available, a ``NotImplementedError``
            will be raised.

        Returns
        -------
        out : array
            The inverse log-CCDF evaluated at the provided argument.

        Notes
        -----
        Suppose a probability distribution has support :math:`[l, r]`. The
        inverse log-CCDF returns its minimum value of :math:`l` at
        :math:`\log(p) = \log(1) = 0` and its maximum value of :math:`r` at
        :math:`\log(p) = \log(0) = -\infty`. Because the log-CCDF has range
        :math:`[-\infty, 0]`, the inverse log-CDF is only defined on the
        negative reals; for :math:`\log(p) > 0`, `ilogccdf` returns ``nan``.

        Occasionally, it is needed to find the argument of the CCDF for which
        the resulting probability is very close to ``0`` or ``1`` - too close to
        represent accurately with floating point arithmetic. In many cases,
        however, the *logarithm* of this resulting probability may be
        represented in floating point arithmetic, in which case this function
        may be used to find the argument of the CCDF for which the *logarithm*
        of the resulting probability is :math:`y = \log(p)`.

        The "logarithmic complement" of a number :math:`z` is mathematically
        equivalent to :math:`\log(1-\exp(z))`, but it is computed to avoid loss
        of precision when :math:`\exp(z)` is nearly :math:`0` or :math:`1`.

        See Also
        --------
        iccdf
        ilogccdf

        Examples
        --------
        Instantiate a distribution with the desired parameters:

        >>> import numpy as np
        >>> from scipy import stats
        >>> X = stats.Uniform(a=-0.5, b=0.5)

        Evaluate the inverse log-CCDF at the desired argument:

        >>> X.ilogccdf(-0.25)
        -0.2788007830714034
        >>> np.allclose(X.ilogccdf(-0.25), X.iccdf(np.exp(-0.25)))
        True

        """
        raise NotImplementedError()

    @abstractmethod
    def logentropy(self, *, method):
        r"""Logarithm of the differential entropy

        In terms of probability density function :math:`f(x)` and support
        :math:`\chi`, the differential entropy (or simply "entropy") of a
        continuous random variable :math:`X` is:

        .. math::

            h(X) = - \int_{\chi} f(x) \log f(x) dx

        The definition for a discrete random variable is analogous, with the PMF
        replacing the PDF and a sum over the support replacing the integral.

        `logentropy` computes the logarithm of the differential entropy
        ("log-entropy"), :math:`\log(h(X))`, but it may be numerically favorable
        compared to the naive implementation (computing :math:`h(X)` then
        taking the logarithm).

        Parameters
        ----------
        method : {None, 'formula', 'logexp', 'quadrature}
            The strategy used to evaluate the log-entropy. By default
            (``None``), the infrastructure chooses between the following options,
            listed in order of precedence.

            - ``'formula'``: use a formula for the log-entropy itself
            - ``'logexp'``: evaluate the entropy and take the logarithm
            - ``'quadrature'``: numerically log-integrate (or, in the discrete
              case, log-sum) the logarithm of the entropy integrand (summand)

            Not all `method` options are available for all distributions.
            If the selected `method` is not available, a ``NotImplementedError``
            will be raised.

        Returns
        -------
        out : array
            The log-entropy.

        See Also
        --------
        entropy
        logpdf

        Notes
        -----
        The differential entropy of a continuous distribution can be negative.
        In this case, the log-entropy is complex with imaginary part :math:`\pi`.
        For consistency, the result of this function always has complex dtype,
        regardless of the value of the imaginary part.

        References
        ----------
        .. [1] Differential entropy, *Wikipedia*,
               https://en.wikipedia.org/wiki/Differential_entropy

        Examples
        --------
        Instantiate a distribution with the desired parameters:

        >>> import numpy as np
        >>> from scipy import stats
        >>> X = stats.Uniform(a=-1., b=1.)

        Evaluate the log-entropy:

        >>> X.logentropy()
        (-0.3665129205816642+0j)
        >>> np.allclose(np.exp(X.logentropy()), X.entropy())
        True

        For a random variable with negative entropy, the log-entropy has an
        imaginary part equal to `np.pi`.

        >>> X = stats.Uniform(a=-.1, b=.1)
        >>> X.entropy(), X.logentropy()
        (-1.6094379124341007, (0.4758849953271105+3.141592653589793j))

        """
        raise NotImplementedError()

    @abstractmethod
    def entropy(self, *, method):
        r"""Differential entropy

        In terms of probability density function :math:`f(x)` and support
        :math:`\chi`, the differential entropy (or simply "entropy") of a
        continuous random variable :math:`X` is:

        .. math::

            h(X) = - \int_{\chi} f(x) \log f(x) dx

        The definition for a discrete random variable is analogous, with the
        PMF replacing the PDF and a sum over the support replacing the integral.

        Parameters
        ----------
        method : {None, 'formula', 'logexp', 'quadrature'}
            The strategy used to evaluate the entropy. By default (``None``),
            the infrastructure chooses between the following options, listed
            in order of precedence.

            - ``'formula'``: use a formula for the entropy itself
            - ``'logexp'``: evaluate the log-entropy and exponentiate
            - ``'quadrature'``:  numerically integrate (or, in the discrete
              case, sum) the entropy integrand (summand)


            Not all `method` options are available for all distributions.
            If the selected `method` is not available, a ``NotImplementedError``
            will be raised.

        Returns
        -------
        out : array
            The entropy of the random variable.

        See Also
        --------
        logentropy
        pdf

        Notes
        -----
        This function calculates the entropy using the natural logarithm; i.e.
        the logarithm with base :math:`e`. Consequently, the value is expressed
        in (dimensionless) "units" of nats. To convert the entropy to different
        units (i.e. corresponding with a different base), divide the result by
        the natural logarithm of the desired base.

        References
        ----------
        .. [1] Differential entropy, *Wikipedia*,
               https://en.wikipedia.org/wiki/Differential_entropy

        Examples
        --------
        Instantiate a distribution with the desired parameters:

        >>> from scipy import stats
        >>> X = stats.Uniform(a=-1., b=1.)

        Evaluate the entropy:

        >>> X.entropy()
        0.6931471805599454

        """
        raise NotImplementedError()
