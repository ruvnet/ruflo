import numpy as np

from scipy._lib._array_api import (
    array_namespace, xp_ravel, xp_copy, xp_promote
)
import scipy._lib._elementwise_iterative_method as eim
from scipy._lib._util import _RichResult
from scipy import special

# Todo:
# Avoid special-casing key 'n' in _lib._elementwise_iterative_method::_check_termination
# Rearrange termination condition to allow absolute and relative tolerances?
# Interpret/return |f_n - f_{n-1}| as an error estimate?
# Return gracefully for size=0 arrays

def _logaddexp(x, y, xp=None):
    # logaddexp that supports complex numbers
    xp = array_namespace(x, y) if xp is None else xp
    x, y = xp.broadcast_arrays(x, y)
    xy = xp.stack((x, y), axis=0)
    return special.logsumexp(xy, axis=0)


def _continued_fraction_iv(a, b, args, tolerances, maxiter, log):
    # Input validation for `_continued_fraction`

    if not callable(a) or not callable(b):
        raise ValueError('`a` and `b` must be callable.')

    if not np.iterable(args):
        args = (args,)

    # Call each callable once to determine namespace and dtypes
    a0, b0 = a(0, *args), b(0, *args)
    xp = array_namespace(a0, b0, *args)
    a0, b0, *args = xp_promote(a0, b0, *args, force_floating=True, broadcast=True,
                               xp=xp)
    shape, dtype = a0.shape, a0.dtype
    a0, b0, *args = (xp_ravel(arg) for arg in (a0, b0) + tuple(args))

    tolerances = {} if tolerances is None else tolerances
    eps = tolerances.get('eps', None)
    tiny = tolerances.get('tiny', None)

    # tolerances are floats, not arrays, so it's OK to use NumPy
    message = ('`eps` and `tiny` must be (or represent the logarithm of) '
               'finite, positive, real scalars.')
    tols = np.asarray([eps if eps is not None else 1,
                       tiny if tiny is not None else 1])
    not_real = (not np.issubdtype(tols.dtype, np.number)
                or np.issubdtype(tols.dtype, np.complexfloating))
    not_positive = np.any(tols <= 0) if not log else False
    not_finite = not np.all(np.isfinite(tols))
    not_scalar = tols.shape != (2,)
    if not_real or not_positive or not_finite or not_scalar:
        raise ValueError(message)

    maxiter_int = int(maxiter)
    if maxiter != maxiter_int or maxiter < 0:
        raise ValueError('`maxiter` must be a non-negative integer.')

    if not isinstance(log, bool):
        raise ValueError('`log` must be boolean.')

    return a, b, args, eps, tiny, maxiter, log, a0, b0, shape, dtype, xp


def _continued_fraction(a, b, *, args=(), tolerances=None, maxiter=100, log=False):
    r"""Evaluate a generalized continued fraction numerically.

    `_continued_fraction` iteratively evaluates convergents of a continued fraction
    given coefficients returned by callables `a` and `b`. Iteration terminates when
    `maxiter` terms have been evaluated or a termination criterion controlled by
    `tolerances` is satisfied, and the final convergent is returned as the ``f``
    attribute of the result object.

    This function works elementwise when `args` contains (broadcastable) arrays.

    Parameters
    ----------
    a, b: callable
        Functions that provide the *numerator* and *denominator* coefficients of
        the continued fraction, respectively.

        The signature of each must be::

            a(n: int, *argsj) -> ndarray

        where ``n`` is the coefficient number and ``argsj`` is a tuple, which may
        contain an arbitrary number of arrays of any shape. `a` and `b` must be
        elementwise functions: each scalar element ``a(n, *argsj)[i]`` must equal
        ``a(n, *[argj[i] for argj in argsj])`` for valid indices ``i``.
        `a` and `b` must not mutate the arrays in ``argsj``.

        The result shape is the broadcasted shape of ``a(0, *args)`` and
        ``b(0, *args)``. The dtype used throughout computation is the result dtype
        of these terms if it is a float, and the default float of the array library
        otherwise. The numerical value of ``a(0, *args)`` is ignored, and
        the value of the leading term ``b(0, *args)`` is the so-called "integer"
        part of the continued fraction (although it need not be integral).

    args : tuple of array_like, optional
        Additional positional *array* arguments to be passed to `a` and `b`. Arrays
        must be broadcastable with one another. If the coefficient callables
        require additional arguments that are not broadcastable with one
        another, wrap them with callables `a` and `b` such that `a` and `b` accept
        only ``n`` and broadcastable array arguments.
    tolerances : dictionary of floats, optional
        Tolerances and numerical thresholds used by the algorithm. Currently,
        valid keys of the dictionary are:

        - ``eps`` - the convergence threshold of Lentz' algorithm
        - ``tiny`` - not strictly a "tolerance", but a very small positive number
          used to avoid division by zero

        The default `eps` is the precision of the appropriate dtype, and the default
        `tiny` is the precision squared. [1]_ advises that ``eps`` is "as small as
        you like", but for most purposes, it should not be set smaller than the default
        because it may prevent convergence of the algorithm. [1]_ also advises that
        ``tiny`` should be less than typical values of ``eps * b(n)``, so the default
        is a good choice unless the :math:`b_n` are very small. See [1]_ for details.
    maxiter : int, default: 100
        The maximum number of iterations of the algorithm to perform.
    log : bool, default: False
        If True, `a` and `b` return the (natural) logarithm of the terms, `tolerances`
        contains the logarithm of the tolerances, and the result object reports the
        logarithm of the convergent.

    Returns
    -------
    res : _RichResult
        An object similar to an instance of `scipy.optimize.OptimizeResult` with the
        following attributes. The descriptions are written as though the values will
        be scalars; however, if `f` returns an array, the outputs will be
        arrays of the same shape.

        success : bool array
            ``True`` where the algorithm terminated successfully (status ``0``);
            ``False`` otherwise.
        status : int array
            An integer representing the exit status of the algorithm.

            - ``0`` : The algorithm converged to the specified tolerances.
            - ``-2`` : The maximum number of iterations was reached.
            - ``-3`` : A non-finite value was encountered.

        f : float array
            The convergent which satisfied a termination criterion.
        nit : int array
            The number of iterations of the algorithm that were performed.
        nfev : int array
            The number of terms that were evaluated.

    Notes
    -----
    A generalized continued fraction is an expression of the form

    .. math::

        b_0 + \frac{a_1}{b_1 + \frac{a_2}{b_2 + \frac{a_3}{b_3 + \cdots}}}

    Successive "convergents" approximate the infinitely recursive continued fraction
    with a finite number of terms :math:`a_n` and :math:`b_n`, which are provided
    by callables `a` and `b`, respectively. This implementation follows the modified
    Lentz algorithm ([1]_, [2]_) to evaluate successive convergents until a
    termination condition is satisfied.

    References
    ----------
    .. [1] Press, William H., and Saul A. Teukolsky. "Evaluating continued fractions
           and computing exponential integrals." Computers in Physics 2.5 (1988): 88-89.
    .. [2] Lentz's algorithm. Wikipedia.
           https://en.wikipedia.org/wiki/Lentz%27s_algorithm
    .. [3] Continued fraction. Wikipedia.
           https://en.wikipedia.org/wiki/Continued_fraction
    .. [4] Generalized continued fraction. Wikipedia.
           https://en.wikipedia.org/wiki/Generalized_continued_fraction

    Examples
    --------
    The "simple continued fraction" of :math:`\pi` is given in [3]_ as

    .. math::

        3 + \frac{1}{7 + \frac{1}{15 + \frac{1}{1 + \cdots}}}

    where the :math:`b_n` terms follow no obvious pattern:

    >>> b = [3, 7, 15, 1, 292, 1, 1, 1, 2, 1, 3, 1]

    and the :math:`a_n` terms are all :math:`1`.
    In this case, all the terms have been precomputed, so we call `_continued_fraction`
    with simple callables which simply return the precomputed coefficients:

    >>> import numpy as np
    >>> from scipy.special._continued_fraction import _continued_fraction
    >>> res = _continued_fraction(a=lambda n: 1, b=lambda n: b[n], maxiter=len(b) - 1)
    >>> (res.f - np.pi) / np.pi
    np.float64(7.067899292141148e-15)

    A generalized continued fraction for :math:`\pi` is given by:

    .. math::

        3 + \frac{1^2}{6 + \frac{3^2}{6 + \frac{5^2}{6 + \cdots}}}

    We define the coefficient callables as:

    >>> def a(n):
    ...     return (2*n - 1)**2
    >>>
    >>> def b(n):
    ...     if n == 0:
    ...         return 3
    ...     else:
    ...         return 6

    Then the continued fraction can be evaluated as:

    >>> res = _continued_fraction(a, b)
    >>> res
         success: False
          status: -2
               f: 3.1415924109719846
             nit: 100
            nfev: 101

    Note that the requested tolerance was not reached within the (default)
    maximum number of iterations because it converges very slowly.
    An expression that converges more rapidly is expressed as the difference
    between two continued fractions. We will compute both of them in one
    vectorized call to `_continued_fraction`.

    >>> u, v = 5, 239
    >>>
    >>> def a(n, a1, _):
    ...     # The shape of the output must be the shape of the arguments
    ...     shape = a1.shape
    ...     if n == 0:
    ...         return np.zeros(shape)
    ...     elif n == 1:
    ...         return a1
    ...     else:
    ...         return np.full(shape, (n-1)**2)
    >>>
    >>> def b(n, _, uv):
    ...     shape = uv.shape
    ...     if  n == 0:
    ...         return np.zeros(shape)
    ...     return np.full(shape, (2*n - 1)*uv)
    >>>
    >>> res = _continued_fraction(a, b, args=([16, 4], [u, v]))
    >>> res
         success: [ True  True]
          status: [0 0]
               f: [ 3.158e+00  1.674e-02]
             nit: [10  4]
            nfev: [11  5]

    Note that the second term converged in fewer than half the number of iterations
    as the first. The approximation of :math:`\pi` is the difference between the two:

    >>> pi = res.f[0] - res.f[1]
    >>> (pi - np.pi) / np.pi
    np.float64(2.8271597168564594e-16)

    If it is more efficient to compute the :math:`a_n` and :math:`b_n` terms together,
    consider instantiating a class with a method that computes both terms and stores
    the results in an attribute. Separate methods of the class retrieve the
    coefficients, and these methods are passed to `_continued_fraction` as arguments
    `a` and `b`. Similarly,if the coefficients can be computed recursively in terms of
    previous coefficients, use a class to maintain state between callable evaluations.

    """

    res = _continued_fraction_iv(a, b, args, tolerances, maxiter, log)
    a, b, args, eps, tiny, maxiter, log, a0, b0, shape, dtype, xp = res
    callback = None  # don't want to test it, but easy to add later

    # The EIM framework was designed for the case in where there would
    # be only one callable, and all arguments of the callable would be
    # arrays. We're going a bit beyond that here, since we have two callables,
    # and the first argument is an integer (the number of the term). Rather
    # than complicate the framework, we wrap the user-provided callables to
    # make this problem fit within the existing framework.

    def a(n, *args, a=a):
        n = int(xp.real(xp_ravel(n))[0])
        return a(n, *args)

    def b(n, *args, b=b):
        n = int(xp.real(xp_ravel(n))[0])
        return b(n, *args)

    def func(n, *args):
        return xp.stack((a(n, *args), b(n, *args)), axis=-1)

    status = xp.full_like(a0, eim._EINPROGRESS, dtype=xp.int32)  # in progress
    nit, nfev = 0, 1  # one function evaluation (per function) performed above
    maxiter = 100 if maxiter is None else maxiter

    # Quotations describing the algorithm are from [1]_
    # "... as small as you like, say eps"
    if eps is None:
        eps = xp.finfo(dtype).eps if not log else np.log(xp.finfo(dtype).eps)

    # "The parameter tiny should be less than typical values of eps |b_n|"
    if tiny is None:
        tiny = xp.finfo(dtype).eps**2 if not log else 2*np.log(xp.finfo(dtype).eps)

    # "Set f0 and C0 to the value b0 or to tiny if b0=0. Set D0 = 0.
    zero = -xp.inf if log else 0
    fn = xp.where(b0 == zero, tiny, b0)
    Cnm1 = xp_copy(fn)
    Dnm1 = xp.full_like(fn, zero)

    CnDn = xp.full_like(fn, xp.inf)

    work = _RichResult(n=0, fn=fn, Cnm1=Cnm1, Dnm1=Dnm1, CnDn=CnDn,
                       eps=eps, tiny=tiny,
                       nit=nit, nfev=nfev, status=status)
    res_work_pairs = [('status', 'status'), ('f', 'fn'),
                      ('nit', 'nit'), ('nfev', 'nfev')]

    def pre_func_eval(work):
        work.n = xp.reshape(xp.asarray(work.n + 1), (-1,))
        return work.n

    def post_func_eval(n, ab, work):
        an, bn = ab[..., 0], ab[..., 1]

        zero = 0 if not log else -xp.inf

        # "Set D_n = 1/(b_n + a_n D_{n-1}) or 1/tiny, if the denominator vanishes"
        denominator = (bn + an*work.Dnm1 if not log
                       else _logaddexp(bn, an + work.Dnm1, xp=xp))
        denominator[denominator == zero] = tiny
        Dn = (1/denominator if not log
              else -denominator)

        # "Set C_n = b_n + a_n / C_{n-1} (or =tiny, if the expression vanishes)"
        Cn = (bn + an / work.Cnm1 if not log
              else _logaddexp(bn, an - work.Cnm1, xp=xp))
        Cn[Cn == zero] = tiny

        # "and set f_n = f_{n-1} C_n D_n"
        work.CnDn = (Cn * Dn if not log
                     else Cn + Dn)
        work.fn = (work.fn * work.CnDn if not log
                   else work.fn + work.CnDn)


        work.Cnm1, work.Dnm1 = Cn, Dn

    def check_termination(work):
        # Check for all terminal conditions and record statuses.
        stop = xp.zeros_like(work.CnDn, dtype=xp.bool)

        # "You quit when |D_n C_n - 1| is as small as you like, say eps"
        pij = xp.full_like(work.CnDn, xp.pi*1j) if log else None
        residual = (xp.abs(work.CnDn - 1) if not log
                    else xp.real(_logaddexp(work.CnDn, pij, xp=xp)))
        i = residual < work.eps
        work.status[i] = eim._ECONVERGED
        stop[i] = True

        # If function value is NaN, report failure.
        i = (~xp.isfinite(work.fn) if not log
             else ~(xp.isfinite(work.fn) | (work.fn == -xp.inf)))
        work.status[i] = eim._EVALUEERR
        stop[i] = True

        return stop

    def post_termination_check(work):
        pass

    def customize_result(res, shape):
        # Only needed pre-NEP 50
        res['f'] = xp.asarray(res['f'], dtype=dtype)
        res['f'] = res['f'][()] if res['f'].ndim == 0 else res['f']
        return shape

    return eim._loop(work, callback, shape, maxiter, func, args, dtype,
                     pre_func_eval, post_func_eval, check_termination,
                     post_termination_check, customize_result, res_work_pairs,
                     xp=xp)
