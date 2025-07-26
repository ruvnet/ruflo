# mypy: disable-error-code="attr-defined"
import math
import numpy as np
from scipy import special
import scipy._lib._elementwise_iterative_method as eim
from scipy._lib._util import _RichResult
from scipy._lib._array_api import (array_namespace, xp_copy, xp_ravel,
                                   xp_promote)


__all__ = ['nsum']


# todo:
#  figure out warning situation
#  address https://github.com/scipy/scipy/pull/18650#discussion_r1233032521
#  without `minweight`, we are also suppressing infinities within the interval.
#    Is that OK? If so, we can probably get rid of `status=3`.
#  Add heuristic to stop when improvement is too slow / antithrashing
#  support singularities? interval subdivision? this feature will be added
#    eventually, but do we adjust the interface now?
#  When doing log-integration, should the tolerances control the error of the
#    log-integral or the error of the integral?  The trouble is that `log`
#    inherently looses some precision so it may not be possible to refine
#    the integral further. Example: 7th moment of stats.f(15, 20)
#  respect function evaluation limit?
#  make public?


def tanhsinh(f, a, b, *, args=(), log=False, maxlevel=None, minlevel=2,
             atol=None, rtol=None, preserve_shape=False, callback=None):
    """Evaluate a convergent integral numerically using tanh-sinh quadrature.

    In practice, tanh-sinh quadrature achieves quadratic convergence for
    many integrands: the number of accurate *digits* scales roughly linearly
    with the number of function evaluations [1]_.

    Either or both of the limits of integration may be infinite, and
    singularities at the endpoints are acceptable. Divergent integrals and
    integrands with non-finite derivatives or singularities within an interval
    are out of scope, but the latter may be evaluated be calling `tanhsinh` on
    each sub-interval separately.

    Parameters
    ----------
    f : callable
        The function to be integrated. The signature must be::

            f(xi: ndarray, *argsi) -> ndarray

        where each element of ``xi`` is a finite real number and ``argsi`` is a tuple,
        which may contain an arbitrary number of arrays that are broadcastable
        with ``xi``. `f` must be an elementwise function: see documentation of parameter
        `preserve_shape` for details. It must not mutate the array ``xi`` or the arrays
        in ``argsi``.
        If ``f`` returns a value with complex dtype when evaluated at
        either endpoint, subsequent arguments ``x`` will have complex dtype
        (but zero imaginary part).
    a, b : float array_like
        Real lower and upper limits of integration. Must be broadcastable with one
        another and with arrays in `args`. Elements may be infinite.
    args : tuple of array_like, optional
        Additional positional array arguments to be passed to `f`. Arrays
        must be broadcastable with one another and the arrays of `a` and `b`.
        If the callable for which the root is desired requires arguments that are
        not broadcastable with `x`, wrap that callable with `f` such that `f`
        accepts only `x` and broadcastable ``*args``.
    log : bool, default: False
        Setting to True indicates that `f` returns the log of the integrand
        and that `atol` and `rtol` are expressed as the logs of the absolute
        and relative errors. In this case, the result object will contain the
        log of the integral and error. This is useful for integrands for which
        numerical underflow or overflow would lead to inaccuracies.
        When ``log=True``, the integrand (the exponential of `f`) must be real,
        but it may be negative, in which case the log of the integrand is a
        complex number with an imaginary part that is an odd multiple of π.
    maxlevel : int, default: 10
        The maximum refinement level of the algorithm.

        At the zeroth level, `f` is called once, performing 16 function
        evaluations. At each subsequent level, `f` is called once more,
        approximately doubling the number of function evaluations that have
        been performed. Accordingly, for many integrands, each successive level
        will double the number of accurate digits in the result (up to the
        limits of floating point precision).

        The algorithm will terminate after completing level `maxlevel` or after
        another termination condition is satisfied, whichever comes first.
    minlevel : int, default: 2
        The level at which to begin iteration (default: 2). This does not
        change the total number of function evaluations or the abscissae at
        which the function is evaluated; it changes only the *number of times*
        `f` is called. If ``minlevel=k``, then the integrand is evaluated at
        all abscissae from levels ``0`` through ``k`` in a single call.
        Note that if `minlevel` exceeds `maxlevel`, the provided `minlevel` is
        ignored, and `minlevel` is set equal to `maxlevel`.
    atol, rtol : float, optional
        Absolute termination tolerance (default: 0) and relative termination
        tolerance (default: ``eps**0.75``, where ``eps`` is the precision of
        the result dtype), respectively. Must be non-negative and finite if
        `log` is False, and must be expressed as the log of a non-negative and
        finite number if `log` is True. Iteration will stop when
        ``res.error < atol`` or  ``res.error < res.integral * rtol``.
    preserve_shape : bool, default: False
        In the following, "arguments of `f`" refers to the array ``xi`` and
        any arrays within ``argsi``. Let ``shape`` be the broadcasted shape
        of `a`, `b`, and all elements of `args` (which is conceptually
        distinct from ``xi` and ``argsi`` passed into `f`).

        - When ``preserve_shape=False`` (default), `f` must accept arguments
          of *any* broadcastable shapes.

        - When ``preserve_shape=True``, `f` must accept arguments of shape
          ``shape`` *or* ``shape + (n,)``, where ``(n,)`` is the number of
          abscissae at which the function is being evaluated.

        In either case, for each scalar element ``xi[j]`` within ``xi``, the array
        returned by `f` must include the scalar ``f(xi[j])`` at the same index.
        Consequently, the shape of the output is always the shape of the input
        ``xi``.

        See Examples.

    callback : callable, optional
        An optional user-supplied function to be called before the first
        iteration and after each iteration.
        Called as ``callback(res)``, where ``res`` is a ``_RichResult``
        similar to that returned by `tanhsinh` (but containing the
        current iterate's values of all variables). If `callback` raises a
        ``StopIteration``, the algorithm will terminate immediately and
        `tanhsinh` will return a result object. `callback` must not mutate
        `res` or its attributes.

    Returns
    -------
    res : _RichResult
        An object similar to an instance of `scipy.optimize.OptimizeResult` with the
        following attributes. (The descriptions are written as though the values will
        be scalars; however, if `f` returns an array, the outputs will be
        arrays of the same shape.)

        success : bool array
            ``True`` when the algorithm terminated successfully (status ``0``).
            ``False`` otherwise.
        status : int array
            An integer representing the exit status of the algorithm.

            ``0`` : The algorithm converged to the specified tolerances.
            ``-1`` : (unused)
            ``-2`` : The maximum number of iterations was reached.
            ``-3`` : A non-finite value was encountered.
            ``-4`` : Iteration was terminated by `callback`.
            ``1`` : The algorithm is proceeding normally (in `callback` only).

        integral : float array
            An estimate of the integral.
        error : float array
            An estimate of the error. Only available if level two or higher
            has been completed; otherwise NaN.
        maxlevel : int array
            The maximum refinement level used.
        nfev : int array
            The number of points at which `f` was evaluated.

    See Also
    --------
    quad

    Notes
    -----
    Implements the algorithm as described in [1]_ with minor adaptations for
    finite-precision arithmetic, including some described by [2]_ and [3]_. The
    tanh-sinh scheme was originally introduced in [4]_.

    Two error estimation schemes are described in [1]_ Section 5: one attempts to
    detect and exploit quadratic convergence; the other simply compares the integral
    estimates at successive levels. While neither is theoretically rigorous or
    conservative, both work well in practice. Our error estimate uses the minimum of
    these two schemes with a lower bound of ``eps * res.integral``.

    Due to floating-point error in the abscissae, the function may be evaluated
    at the endpoints of the interval during iterations, but the values returned by
    the function at the endpoints will be ignored.

    References
    ----------
    .. [1] Bailey, David H., Karthik Jeyabalan, and Xiaoye S. Li. "A comparison of
           three high-precision quadrature schemes." Experimental Mathematics 14.3
           (2005): 317-329.
    .. [2] Vanherck, Joren, Bart Sorée, and Wim Magnus. "Tanh-sinh quadrature for
           single and multiple integration using floating-point arithmetic."
           arXiv preprint arXiv:2007.15057 (2020).
    .. [3] van Engelen, Robert A.  "Improving the Double Exponential Quadrature
           Tanh-Sinh, Sinh-Sinh and Exp-Sinh Formulas."
           https://www.genivia.com/files/qthsh.pdf
    .. [4] Takahasi, Hidetosi, and Masatake Mori. "Double exponential formulas for
           numerical integration." Publications of the Research Institute for
           Mathematical Sciences 9.3 (1974): 721-741.

    Examples
    --------
    Evaluate the Gaussian integral:

    >>> import numpy as np
    >>> from scipy.integrate import tanhsinh
    >>> def f(x):
    ...     return np.exp(-x**2)
    >>> res = tanhsinh(f, -np.inf, np.inf)
    >>> res.integral  # true value is np.sqrt(np.pi), 1.7724538509055159
    1.7724538509055159
    >>> res.error  # actual error is 0
    4.0007963937534104e-16

    The value of the Gaussian function (bell curve) is nearly zero for
    arguments sufficiently far from zero, so the value of the integral
    over a finite interval is nearly the same.

    >>> tanhsinh(f, -20, 20).integral
    1.772453850905518

    However, with unfavorable integration limits, the integration scheme
    may not be able to find the important region.

    >>> tanhsinh(f, -np.inf, 1000).integral
    4.500490856616431

    In such cases, or when there are singularities within the interval,
    break the integral into parts with endpoints at the important points.

    >>> tanhsinh(f, -np.inf, 0).integral + tanhsinh(f, 0, 1000).integral
    1.772453850905404

    For integration involving very large or very small magnitudes, use
    log-integration. (For illustrative purposes, the following example shows a
    case in which both regular and log-integration work, but for more extreme
    limits of integration, log-integration would avoid the underflow
    experienced when evaluating the integral normally.)

    >>> res = tanhsinh(f, 20, 30, rtol=1e-10)
    >>> res.integral, res.error
    (4.7819613911309014e-176, 4.670364401645202e-187)
    >>> def log_f(x):
    ...     return -x**2
    >>> res = tanhsinh(log_f, 20, 30, log=True, rtol=np.log(1e-10))
    >>> np.exp(res.integral), np.exp(res.error)
    (4.7819613911306924e-176, 4.670364401645093e-187)

    The limits of integration and elements of `args` may be broadcastable
    arrays, and integration is performed elementwise.

    >>> from scipy import stats
    >>> dist = stats.gausshyper(13.8, 3.12, 2.51, 5.18)
    >>> a, b = dist.support()
    >>> x = np.linspace(a, b, 100)
    >>> res = tanhsinh(dist.pdf, a, x)
    >>> ref = dist.cdf(x)
    >>> np.allclose(res.integral, ref)
    True

    By default, `preserve_shape` is False, and therefore the callable
    `f` may be called with arrays of any broadcastable shapes.
    For example:

    >>> shapes = []
    >>> def f(x, c):
    ...    shape = np.broadcast_shapes(x.shape, c.shape)
    ...    shapes.append(shape)
    ...    return np.sin(c*x)
    >>>
    >>> c = [1, 10, 30, 100]
    >>> res = tanhsinh(f, 0, 1, args=(c,), minlevel=1)
    >>> shapes
    [(4,), (4, 34), (4, 32), (3, 64), (2, 128), (1, 256)]

    To understand where these shapes are coming from - and to better
    understand how `tanhsinh` computes accurate results - note that
    higher values of ``c`` correspond with higher frequency sinusoids.
    The higher frequency sinusoids make the integrand more complicated,
    so more function evaluations are required to achieve the target
    accuracy:

    >>> res.nfev
    array([ 67, 131, 259, 515], dtype=int32)

    The initial ``shape``, ``(4,)``, corresponds with evaluating the
    integrand at a single abscissa and all four frequencies; this is used
    for input validation and to determine the size and dtype of the arrays
    that store results. The next shape corresponds with evaluating the
    integrand at an initial grid of abscissae and all four frequencies.
    Successive calls to the function double the total number of abscissae at
    which the function has been evaluated. However, in later function
    evaluations, the integrand is evaluated at fewer frequencies because
    the corresponding integral has already converged to the required
    tolerance. This saves function evaluations to improve performance, but
    it requires the function to accept arguments of any shape.

    "Vector-valued" integrands, such as those written for use with
    `scipy.integrate.quad_vec`, are unlikely to satisfy this requirement.
    For example, consider

    >>> def f(x):
    ...    return [x, np.sin(10*x), np.cos(30*x), x*np.sin(100*x)**2]

    This integrand is not compatible with `tanhsinh` as written; for instance,
    the shape of the output will not be the same as the shape of ``x``. Such a
    function *could* be converted to a compatible form with the introduction of
    additional parameters, but this would be inconvenient. In such cases,
    a simpler solution would be to use `preserve_shape`.

    >>> shapes = []
    >>> def f(x):
    ...     shapes.append(x.shape)
    ...     x0, x1, x2, x3 = x
    ...     return [x0, np.sin(10*x1), np.cos(30*x2), x3*np.sin(100*x3)]
    >>>
    >>> a = np.zeros(4)
    >>> res = tanhsinh(f, a, 1, preserve_shape=True)
    >>> shapes
    [(4,), (4, 66), (4, 64), (4, 128), (4, 256)]

    Here, the broadcasted shape of `a` and `b` is ``(4,)``. With
    ``preserve_shape=True``, the function may be called with argument
    ``x`` of shape ``(4,)`` or ``(4, n)``, and this is what we observe.

    """
    maxfun = None  # unused right now
    (f, a, b, log, maxfun, maxlevel, minlevel,
     atol, rtol, args, preserve_shape, callback, xp) = _tanhsinh_iv(
        f, a, b, log, maxfun, maxlevel, minlevel, atol,
        rtol, args, preserve_shape, callback)

    # Initialization
    # `eim._initialize` does several important jobs, including
    # ensuring that limits, each of the `args`, and the output of `f`
    # broadcast correctly and are of consistent types. To save a function
    # evaluation, I pass the midpoint of the integration interval. This comes
    # at a cost of some gymnastics to ensure that the midpoint has the right
    # shape and dtype. Did you know that 0d and >0d arrays follow different
    # type promotion rules?
    with np.errstate(over='ignore', invalid='ignore', divide='ignore'):
        c = xp.reshape((xp_ravel(a) + xp_ravel(b))/2, a.shape)
        inf_a, inf_b = xp.isinf(a), xp.isinf(b)
        c[inf_a] = b[inf_a] - 1.  # takes care of infinite a
        c[inf_b] = a[inf_b] + 1.  # takes care of infinite b
        c[inf_a & inf_b] = 0.  # takes care of infinite a and b
        temp = eim._initialize(f, (c,), args, complex_ok=True,
                               preserve_shape=preserve_shape, xp=xp)
    f, xs, fs, args, shape, dtype, xp = temp
    a = xp_ravel(xp.astype(xp.broadcast_to(a, shape), dtype))
    b = xp_ravel(xp.astype(xp.broadcast_to(b, shape), dtype))

    # Transform improper integrals
    a, b, a0, negative, abinf, ainf, binf = _transform_integrals(a, b, xp)

    # Define variables we'll need
    nit, nfev = 0, 1  # one function evaluation performed above
    zero = -xp.inf if log else 0
    pi = xp.asarray(xp.pi, dtype=dtype)[()]
    maxiter = maxlevel - minlevel + 1
    eps = xp.finfo(dtype).eps
    if rtol is None:
        rtol = 0.75*math.log(eps) if log else eps**0.75

    Sn = xp_ravel(xp.full(shape, zero, dtype=dtype))  # latest integral estimate
    Sn[xp.isnan(a) | xp.isnan(b) | xp.isnan(fs[0])] = xp.nan
    Sk = xp.reshape(xp.empty_like(Sn), (-1, 1))[:, 0:0]  # all integral estimates
    aerr = xp_ravel(xp.full(shape, xp.nan, dtype=dtype))  # absolute error
    status = xp_ravel(xp.full(shape, eim._EINPROGRESS, dtype=xp.int32))
    h0 = _get_base_step(dtype, xp)
    h0 = xp.real(h0) # base step

    # For term `d4` of error estimate ([1] Section 5), we need to keep the
    # most extreme abscissae and corresponding `fj`s, `wj`s in Euler-Maclaurin
    # sum. Here, we initialize these variables.
    xr0 = xp_ravel(xp.full(shape, -xp.inf, dtype=dtype))
    fr0 = xp_ravel(xp.full(shape, xp.nan, dtype=dtype))
    wr0 = xp_ravel(xp.zeros(shape, dtype=dtype))
    xl0 = xp_ravel(xp.full(shape, xp.inf, dtype=dtype))
    fl0 = xp_ravel(xp.full(shape, xp.nan, dtype=dtype))
    wl0 = xp_ravel(xp.zeros(shape, dtype=dtype))
    d4 = xp_ravel(xp.zeros(shape, dtype=dtype))

    work = _RichResult(
        Sn=Sn, Sk=Sk, aerr=aerr, h=h0, log=log, dtype=dtype, pi=pi, eps=eps,
        a=xp.reshape(a, (-1, 1)), b=xp.reshape(b, (-1, 1)),  # integration limits
        n=minlevel, nit=nit, nfev=nfev, status=status,  # iter/eval counts
        xr0=xr0, fr0=fr0, wr0=wr0, xl0=xl0, fl0=fl0, wl0=wl0, d4=d4,  # err est
        ainf=ainf, binf=binf, abinf=abinf, a0=xp.reshape(a0, (-1, 1)),  # transforms
        # Store the xjc/wj pair cache in an object so they can't get compressed
        # Using RichResult to allow dot notation, but a dictionary would suffice
        pair_cache=_RichResult(xjc=None, wj=None, indices=[0], h0=None))  # pair cache

    # Constant scalars don't need to be put in `work` unless they need to be
    # passed outside `tanhsinh`. Examples: atol, rtol, h0, minlevel.

    # Correspondence between terms in the `work` object and the result
    res_work_pairs = [('status', 'status'), ('integral', 'Sn'),
                      ('error', 'aerr'), ('nit', 'nit'), ('nfev', 'nfev')]

    def pre_func_eval(work):
        # Determine abscissae at which to evaluate `f`
        work.h = h0 / 2**work.n
        xjc, wj = _get_pairs(work.n, h0, dtype=work.dtype,
                             inclusive=(work.n == minlevel), xp=xp, work=work)
        work.xj, work.wj = _transform_to_limits(xjc, wj, work.a, work.b, xp)

        # Perform abscissae substitutions for infinite limits of integration
        xj = xp_copy(work.xj)
        xj[work.abinf] = xj[work.abinf] / (1 - xp.real(xj[work.abinf])**2)
        xj[work.binf] = 1/xj[work.binf] - 1 + work.a0[work.binf]
        xj[work.ainf] *= -1
        return xj

    def post_func_eval(x, fj, work):
        # Weight integrand as required by substitutions for infinite limits
        if work.log:
            fj[work.abinf] += (xp.log(1 + work.xj[work.abinf]**2)
                               - 2*xp.log(1 - work.xj[work.abinf]**2))
            fj[work.binf] -= 2 * xp.log(work.xj[work.binf])
        else:
            fj[work.abinf] *= ((1 + work.xj[work.abinf]**2) /
                               (1 - work.xj[work.abinf]**2)**2)
            fj[work.binf] *= work.xj[work.binf]**-2.

        # Estimate integral with Euler-Maclaurin Sum
        fjwj, Sn = _euler_maclaurin_sum(fj, work, xp)
        if work.Sk.shape[-1]:
            Snm1 = work.Sk[:, -1]
            Sn = (special.logsumexp(xp.stack([Snm1 - math.log(2), Sn]), axis=0) if log
                  else Snm1 / 2 + Sn)

        work.fjwj = fjwj
        work.Sn = Sn

    def check_termination(work):
        """Terminate due to convergence or encountering non-finite values"""
        stop = xp.zeros(work.Sn.shape, dtype=bool)

        # Terminate before first iteration if integration limits are equal
        if work.nit == 0:
            i = xp_ravel(work.a == work.b)  # ravel singleton dimension
            zero = xp.asarray(-xp.inf if log else 0.)
            zero = xp.full(work.Sn.shape, zero, dtype=Sn.dtype)
            zero[xp.isnan(Sn)] = xp.nan
            work.Sn[i] = zero[i]
            work.aerr[i] = zero[i]
            work.status[i] = eim._ECONVERGED
            stop[i] = True
        else:
            # Terminate if convergence criterion is met
            rerr, aerr = _estimate_error(work, xp)
            i = (rerr < rtol) | (aerr < atol)
            work.aerr =  xp.reshape(xp.astype(aerr, work.dtype), work.Sn.shape)
            work.status[i] = eim._ECONVERGED
            stop[i] = True

        # Terminate if integral estimate becomes invalid
        if log:
            Sn_real = xp.real(work.Sn)
            Sn_pos_inf = xp.isinf(Sn_real) & (Sn_real > 0)
            i = (Sn_pos_inf | xp.isnan(work.Sn)) & ~stop
        else:
            i = ~xp.isfinite(work.Sn) & ~stop
        work.status[i] = eim._EVALUEERR
        stop[i] = True

        return stop

    def post_termination_check(work):
        work.n += 1
        work.Sk = xp.concat((work.Sk, work.Sn[:, xp.newaxis]), axis=-1)
        return

    def customize_result(res, shape):
        # If the integration limits were such that b < a, we reversed them
        # to perform the calculation, and the final result needs to be negated.
        if log and xp.any(negative):
            res['integral'] = res['integral'] + negative * xp.pi * 1.0j
        else:
            res['integral'][negative] *= -1

        # For this algorithm, it seems more appropriate to report the maximum
        # level rather than the number of iterations in which it was performed.
        res['maxlevel'] = minlevel + res['nit'] - 1
        res['maxlevel'][res['nit'] == 0] = -1
        del res['nit']
        return shape

    # Suppress all warnings initially, since there are many places in the code
    # for which this is expected behavior.
    with np.errstate(over='ignore', invalid='ignore', divide='ignore'):
        res = eim._loop(work, callback, shape, maxiter, f, args, dtype, pre_func_eval,
                        post_func_eval, check_termination, post_termination_check,
                        customize_result, res_work_pairs, xp, preserve_shape)
    return res


def _get_base_step(dtype, xp):
    # Compute the base step length for the provided dtype. Theoretically, the
    # Euler-Maclaurin sum is infinite, but it gets cut off when either the
    # weights underflow or the abscissae cannot be distinguished from the
    # limits of integration. The latter happens to occur first for float32 and
    # float64, and it occurs when `xjc` (the abscissa complement)
    # in `_compute_pair` underflows. We can solve for the argument `tmax` at
    # which it will underflow using [2] Eq. 13.
    fmin = 4*xp.finfo(dtype).smallest_normal  # stay a little away from the limit
    tmax = math.asinh(math.log(2/fmin - 1) / xp.pi)

    # Based on this, we can choose a base step size `h` for level 0.
    # The number of function evaluations will be `2 + m*2^(k+1)`, where `k` is
    # the level and `m` is an integer we get to choose. I choose
    # m = _N_BASE_STEPS = `8` somewhat arbitrarily, but a rationale is that a
    # power of 2 makes floating point arithmetic more predictable. It also
    # results in a base step size close to `1`, which is what [1] uses (and I
    # used here until I found [2] and these ideas settled).
    h0 = tmax / _N_BASE_STEPS
    return xp.asarray(h0, dtype=dtype)[()]


_N_BASE_STEPS = 8


def _compute_pair(k, h0, xp):
    # Compute the abscissa-weight pairs for each level k. See [1] page 9.

    # For now, we compute and store in 64-bit precision. If higher-precision
    # data types become better supported, it would be good to compute these
    # using the highest precision available. Or, once there is an Array API-
    # compatible arbitrary precision array, we can compute at the required
    # precision.

    # "....each level k of abscissa-weight pairs uses h = 2 **-k"
    # We adapt to floating point arithmetic using ideas of [2].
    h = h0 / 2**k
    max = _N_BASE_STEPS * 2**k

    # For iterations after the first, "....the integrand function needs to be
    # evaluated only at the odd-indexed abscissas at each level."
    j = xp.arange(max+1) if k == 0 else xp.arange(1, max+1, 2)
    jh = j * h

    # "In this case... the weights wj = u1/cosh(u2)^2, where..."
    pi_2 = xp.pi / 2
    u1 = pi_2*xp.cosh(jh)
    u2 = pi_2*xp.sinh(jh)
    # Denominators get big here. Overflow then underflow doesn't need warning.
    # with np.errstate(under='ignore', over='ignore'):
    wj = u1 / xp.cosh(u2)**2
    # "We actually store 1-xj = 1/(...)."
    xjc = 1 / (xp.exp(u2) * xp.cosh(u2))  # complement of xj = xp.tanh(u2)

    # When level k == 0, the zeroth xj corresponds with xj = 0. To simplify
    # code, the function will be evaluated there twice; each gets half weight.
    wj[0] = wj[0] / 2 if k == 0 else wj[0]

    return xjc, wj  # store at full precision


def _pair_cache(k, h0, xp, work):
    # Cache the abscissa-weight pairs up to a specified level.
    # Abscissae and weights of consecutive levels are concatenated.
    # `index` records the indices that correspond with each level:
    # `xjc[index[k]:index[k+1]` extracts the level `k` abscissae.
    if not isinstance(h0, type(work.pair_cache.h0)) or h0 != work.pair_cache.h0:
        work.pair_cache.xjc = xp.empty(0)
        work.pair_cache.wj = xp.empty(0)
        work.pair_cache.indices = [0]

    xjcs = [work.pair_cache.xjc]
    wjs = [work.pair_cache.wj]

    for i in range(len(work.pair_cache.indices)-1, k + 1):
        xjc, wj = _compute_pair(i, h0, xp)
        xjcs.append(xjc)
        wjs.append(wj)
        work.pair_cache.indices.append(work.pair_cache.indices[-1] + xjc.shape[0])

    work.pair_cache.xjc = xp.concat(xjcs)
    work.pair_cache.wj = xp.concat(wjs)
    work.pair_cache.h0 = h0


def _get_pairs(k, h0, inclusive, dtype, xp, work):
    # Retrieve the specified abscissa-weight pairs from the cache
    # If `inclusive`, return all up to and including the specified level
    if (len(work.pair_cache.indices) <= k+2
        or not isinstance (h0, type(work.pair_cache.h0))
        or h0 != work.pair_cache.h0):
            _pair_cache(k, h0, xp, work)

    xjc = work.pair_cache.xjc
    wj = work.pair_cache.wj
    indices = work.pair_cache.indices

    start = 0 if inclusive else indices[k]
    end = indices[k+1]

    return xp.astype(xjc[start:end], dtype), xp.astype(wj[start:end], dtype)


def _transform_to_limits(xjc, wj, a, b, xp):
    # Transform integral according to user-specified limits. This is just
    # math that follows from the fact that the standard limits are (-1, 1).
    # Note: If we had stored xj instead of xjc, we would have
    # xj = alpha * xj + beta, where beta = (a + b)/2
    alpha = (b - a) / 2
    xj = xp.concat((-alpha * xjc + b, alpha * xjc + a), axis=-1)
    wj = wj*alpha  # arguments get broadcasted, so we can't use *=
    wj = xp.concat((wj, wj), axis=-1)

    # Points at the boundaries can be generated due to finite precision
    # arithmetic, but these function values aren't supposed to be included in
    # the Euler-Maclaurin sum. Ideally we wouldn't evaluate the function at
    # these points; however, we can't easily filter out points since this
    # function is vectorized. Instead, zero the weights.
    # Note: values may have complex dtype, but have zero imaginary part
    xj_real, a_real, b_real = xp.real(xj), xp.real(a), xp.real(b)
    invalid = (xj_real <= a_real) | (xj_real >= b_real)
    wj[invalid] = 0
    return xj, wj


def _euler_maclaurin_sum(fj, work, xp):
    # Perform the Euler-Maclaurin Sum, [1] Section 4

    # The error estimate needs to know the magnitude of the last term
    # omitted from the Euler-Maclaurin sum. This is a bit involved because
    # it may have been computed at a previous level. I sure hope it's worth
    # all the trouble.
    xr0, fr0, wr0 = work.xr0, work.fr0, work.wr0
    xl0, fl0, wl0 = work.xl0, work.fl0, work.wl0

    # It is much more convenient to work with the transposes of our work
    # variables here.
    xj, fj, wj = work.xj.T, fj.T, work.wj.T
    n_x, n_active = xj.shape  # number of abscissae, number of active elements

    # We'll work with the left and right sides separately
    xr, xl = xp_copy(xp.reshape(xj, (2, n_x // 2, n_active)))  # this gets modified
    fr, fl = xp.reshape(fj, (2, n_x // 2, n_active))
    wr, wl = xp.reshape(wj, (2, n_x // 2, n_active))

    invalid_r = ~xp.isfinite(fr) | (wr == 0)
    invalid_l = ~xp.isfinite(fl) | (wl == 0)

    # integer index of the maximum abscissa at this level
    xr[invalid_r] = -xp.inf
    ir = xp.argmax(xp.real(xr), axis=0, keepdims=True)
    # abscissa, function value, and weight at this index
    ### Not Array API Compatible... yet ###
    xr_max = xp.take_along_axis(xr, ir, axis=0)[0]
    fr_max = xp.take_along_axis(fr, ir, axis=0)[0]
    wr_max = xp.take_along_axis(wr, ir, axis=0)[0]
    # boolean indices at which maximum abscissa at this level exceeds
    # the incumbent maximum abscissa (from all previous levels)
    # note: abscissa may have complex dtype, but will have zero imaginary part
    j = xp.real(xr_max) > xp.real(xr0)
    # Update record of the incumbent abscissa, function value, and weight
    xr0[j] = xr_max[j]
    fr0[j] = fr_max[j]
    wr0[j] = wr_max[j]

    # integer index of the minimum abscissa at this level
    xl[invalid_l] = xp.inf
    il = xp.argmin(xp.real(xl), axis=0, keepdims=True)
    # abscissa, function value, and weight at this index
    xl_min = xp.take_along_axis(xl, il, axis=0)[0]
    fl_min = xp.take_along_axis(fl, il, axis=0)[0]
    wl_min = xp.take_along_axis(wl, il, axis=0)[0]
    # boolean indices at which minimum abscissa at this level is less than
    # the incumbent minimum abscissa (from all previous levels)
    # note: abscissa may have complex dtype, but will have zero imaginary part
    j = xp.real(xl_min) < xp.real(xl0)
    # Update record of the incumbent abscissa, function value, and weight
    xl0[j] = xl_min[j]
    fl0[j] = fl_min[j]
    wl0[j] = wl_min[j]
    fj = fj.T

    # Compute the error estimate `d4` - the magnitude of the leftmost or
    # rightmost term, whichever is greater.
    flwl0 = fl0 + xp.log(wl0) if work.log else fl0 * wl0  # leftmost term
    frwr0 = fr0 + xp.log(wr0) if work.log else fr0 * wr0  # rightmost term
    magnitude = xp.real if work.log else xp.abs
    work.d4 = xp.maximum(magnitude(flwl0), magnitude(frwr0))

    # There are two approaches to dealing with function values that are
    # numerically infinite due to approaching a singularity - zero them, or
    # replace them with the function value at the nearest non-infinite point.
    # [3] pg. 22 suggests the latter, so let's do that given that we have the
    # information.
    fr0b = xp.broadcast_to(fr0[xp.newaxis, :], fr.shape)
    fl0b = xp.broadcast_to(fl0[xp.newaxis, :], fl.shape)
    fr[invalid_r] = fr0b[invalid_r]
    fl[invalid_l] = fl0b[invalid_l]

    # When wj is zero, log emits a warning
    # with np.errstate(divide='ignore'):
    fjwj = fj + xp.log(work.wj) if work.log else fj * work.wj

    # update integral estimate
    Sn = (special.logsumexp(fjwj + xp.log(work.h), axis=-1) if work.log
          else xp.sum(fjwj, axis=-1) * work.h)

    work.xr0, work.fr0, work.wr0 = xr0, fr0, wr0
    work.xl0, work.fl0, work.wl0 = xl0, fl0, wl0

    return fjwj, Sn


def _estimate_error(work, xp):
    # Estimate the error according to [1] Section 5

    if work.n == 0 or work.nit == 0:
        # The paper says to use "one" as the error before it can be calculated.
        # NaN seems to be more appropriate.
        nan = xp.full_like(work.Sn, xp.nan)
        return nan, nan

    indices = work.pair_cache.indices

    n_active = work.Sn.shape[0]  # number of active elements
    axis_kwargs = dict(axis=-1, keepdims=True)

    # With a jump start (starting at level higher than 0), we haven't
    # explicitly calculated the integral estimate at lower levels. But we have
    # all the function value-weight products, so we can compute the
    # lower-level estimates.
    if work.Sk.shape[-1] == 0:
        h = 2 * work.h  # step size at this level
        n_x = indices[work.n]  # number of abscissa up to this level
        # The right and left fjwj terms from all levels are concatenated along
        # the last axis. Get out only the terms up to this level.
        fjwj_rl = xp.reshape(work.fjwj, (n_active, 2, -1))
        fjwj = xp.reshape(fjwj_rl[:, :, :n_x], (n_active, 2*n_x))
        # Compute the Euler-Maclaurin sum at this level
        Snm1 = (special.logsumexp(fjwj, **axis_kwargs) + xp.log(h) if work.log
                else xp.sum(fjwj, **axis_kwargs) * h)
        work.Sk = xp.concat((Snm1, work.Sk), axis=-1)

    if work.n == 1:
        nan = xp.full_like(work.Sn, xp.nan)
        return nan, nan

    # The paper says not to calculate the error for n<=2, but it's not clear
    # about whether it starts at level 0 or level 1. We start at level 0, so
    # why not compute the error beginning in level 2?
    if work.Sk.shape[-1] < 2:
        h = 4 * work.h  # step size at this level
        n_x = indices[work.n-1]  # number of abscissa up to this level
        # The right and left fjwj terms from all levels are concatenated along
        # the last axis. Get out only the terms up to this level.
        fjwj_rl = xp.reshape(work.fjwj, (work.Sn.shape[0], 2, -1))
        fjwj = xp.reshape(fjwj_rl[..., :n_x], (n_active, 2*n_x))
        # Compute the Euler-Maclaurin sum at this level
        Snm2 = (special.logsumexp(fjwj, **axis_kwargs) + xp.log(h) if work.log
                else xp.sum(fjwj, **axis_kwargs) * h)
        work.Sk = xp.concat((Snm2, work.Sk), axis=-1)

    Snm2 = work.Sk[..., -2]
    Snm1 = work.Sk[..., -1]

    e1 = xp.asarray(work.eps)[()]

    if work.log:
        log_e1 = xp.log(e1)
        # Currently, only real integrals are supported in log-scale. All
        # complex values have imaginary part in increments of pi*j, which just
        # carries sign information of the original integral, so use of
        # `xp.real` here is equivalent to absolute value in real scale.
        d1 = xp.real(special.logsumexp(xp.stack([work.Sn, Snm1 + work.pi*1j]), axis=0))
        d2 = xp.real(special.logsumexp(xp.stack([work.Sn, Snm2 + work.pi*1j]), axis=0))
        d3 = log_e1 + xp.max(xp.real(work.fjwj), axis=-1)
        d4 = work.d4
        d5 = log_e1 + xp.real(work.Sn)
        temp = xp.where(d1 > -xp.inf, d1 ** 2 / d2, -xp.inf)
        ds = xp.stack([temp, 2 * d1, d3, d4])
        aerr = xp.clip(xp.max(ds, axis=0), d5, d1)
        rerr = aerr - xp.real(work.Sn)
    else:
        # Note: explicit computation of log10 of each of these is unnecessary.
        d1 = xp.abs(work.Sn - Snm1)
        d2 = xp.abs(work.Sn - Snm2)
        d3 = e1 * xp.max(xp.abs(work.fjwj), axis=-1)
        d4 = work.d4
        d5 = e1 * xp.abs(work.Sn)
        temp = xp.where(d1 > 0, d1**(xp.log(d1)/xp.log(d2)), 0)
        ds = xp.stack([temp, d1**2, d3, d4])
        aerr = xp.clip(xp.max(ds, axis=0), d5, d1)
        rerr = aerr/xp.abs(work.Sn)

    return rerr, aerr


def _transform_integrals(a, b, xp):
    # Transform integrals to a form with finite a <= b
    # For b == a (even infinite), we ensure that the limits remain equal
    # For b < a, we reverse the limits and will multiply the final result by -1
    # For infinite limit on the right, we use the substitution x = 1/t - 1 + a
    # For infinite limit on the left, we substitute x = -x and treat as above
    # For infinite limits, we substitute x = t / (1-t**2)
    ab_same = (a == b)
    a[ab_same], b[ab_same] = 1, 1

    # `a, b` may have complex dtype but have zero imaginary part
    negative = xp.real(b) < xp.real(a)
    a[negative], b[negative] = b[negative], a[negative]

    abinf = xp.isinf(a) & xp.isinf(b)
    a[abinf], b[abinf] = -1, 1

    ainf = xp.isinf(a)
    a[ainf], b[ainf] = -b[ainf], -a[ainf]

    binf = xp.isinf(b)
    a0 = xp_copy(a)
    a[binf], b[binf] = 0, 1

    return a, b, a0, negative, abinf, ainf, binf


def _tanhsinh_iv(f, a, b, log, maxfun, maxlevel, minlevel,
                 atol, rtol, args, preserve_shape, callback):
    # Input validation and standardization

    xp = array_namespace(a, b)
    a, b = xp_promote(a, b, broadcast=True, force_floating=True, xp=xp)

    message = '`f` must be callable.'
    if not callable(f):
        raise ValueError(message)

    message = 'All elements of `a` and `b` must be real numbers.'
    if (xp.isdtype(a.dtype, 'complex floating')
            or xp.isdtype(b.dtype, 'complex floating')):
        raise ValueError(message)

    message = '`log` must be True or False.'
    if log not in {True, False}:
        raise ValueError(message)
    log = bool(log)

    if atol is None:
        atol = -xp.inf if log else 0

    rtol_temp = rtol if rtol is not None else 0.

    # using NumPy for convenience here; these are just floats, not arrays
    params = np.asarray([atol, rtol_temp, 0.])
    message = "`atol` and `rtol` must be real numbers."
    if not np.issubdtype(params.dtype, np.floating):
        raise ValueError(message)

    if log:
        message = '`atol` and `rtol` may not be positive infinity.'
        if np.any(np.isposinf(params)):
            raise ValueError(message)
    else:
        message = '`atol` and `rtol` must be non-negative and finite.'
        if np.any(params < 0) or np.any(np.isinf(params)):
            raise ValueError(message)
    atol = params[0]
    rtol = rtol if rtol is None else params[1]

    BIGINT = float(2**62)
    if maxfun is None and maxlevel is None:
        maxlevel = 10

    maxfun = BIGINT if maxfun is None else maxfun
    maxlevel = BIGINT if maxlevel is None else maxlevel

    message = '`maxfun`, `maxlevel`, and `minlevel` must be integers.'
    params = np.asarray([maxfun, maxlevel, minlevel])
    if not (np.issubdtype(params.dtype, np.number)
            and np.all(np.isreal(params))
            and np.all(params.astype(np.int64) == params)):
        raise ValueError(message)
    message = '`maxfun`, `maxlevel`, and `minlevel` must be non-negative.'
    if np.any(params < 0):
        raise ValueError(message)
    maxfun, maxlevel, minlevel = params.astype(np.int64)
    minlevel = min(minlevel, maxlevel)

    if not np.iterable(args):
        args = (args,)
    args = (xp.asarray(arg) for arg in args)

    message = '`preserve_shape` must be True or False.'
    if preserve_shape not in {True, False}:
        raise ValueError(message)

    if callback is not None and not callable(callback):
        raise ValueError('`callback` must be callable.')

    return (f, a, b, log, maxfun, maxlevel, minlevel,
            atol, rtol, args, preserve_shape, callback, xp)


def _nsum_iv(f, a, b, step, args, log, maxterms, tolerances):
    # Input validation and standardization

    xp = array_namespace(a, b, step)
    a, b, step = xp_promote(a, b, step, broadcast=True, force_floating=True, xp=xp)

    message = '`f` must be callable.'
    if not callable(f):
        raise ValueError(message)

    message = 'All elements of `a`, `b`, and `step` must be real numbers.'
    if not xp.isdtype(a.dtype, ('integral', 'real floating')):
        raise ValueError(message)

    valid_b = b >= a  # NaNs will be False
    valid_step = xp.isfinite(step) & (step > 0)
    valid_abstep = valid_b & valid_step

    message = '`log` must be True or False.'
    if log not in {True, False}:
        raise ValueError(message)

    tolerances = {} if tolerances is None else tolerances

    atol = tolerances.get('atol', None)
    if atol is None:
        atol = -xp.inf if log else 0

    rtol = tolerances.get('rtol', None)
    rtol_temp = rtol if rtol is not None else 0.

    # using NumPy for convenience here; these are just floats, not arrays
    params = np.asarray([atol, rtol_temp, 0.])
    message = "`atol` and `rtol` must be real numbers."
    if not np.issubdtype(params.dtype, np.floating):
        raise ValueError(message)

    if log:
        message = '`atol`, `rtol` may not be positive infinity or NaN.'
        if np.any(np.isposinf(params) | np.isnan(params)):
            raise ValueError(message)
    else:
        message = '`atol`, and `rtol` must be non-negative and finite.'
        if np.any((params < 0) | (~np.isfinite(params))):
            raise ValueError(message)
    atol = params[0]
    rtol = rtol if rtol is None else params[1]

    maxterms_int = int(maxterms)
    if maxterms_int != maxterms or maxterms < 0:
        message = "`maxterms` must be a non-negative integer."
        raise ValueError(message)

    if not np.iterable(args):
        args = (args,)

    return f, a, b, step, valid_abstep, args, log, maxterms_int, atol, rtol, xp


def nsum(f, a, b, *, step=1, args=(), log=False, maxterms=int(2**20), tolerances=None):
    r"""Evaluate a convergent finite or infinite series.

    For finite `a` and `b`, this evaluates::

        f(a + np.arange(n)*step).sum()

    where ``n = int((b - a) / step) + 1``, where `f` is smooth, positive, and
    unimodal. The number of terms in the sum may be very large or infinite,
    in which case a partial sum is evaluated directly and the remainder is
    approximated using integration.

    Parameters
    ----------
    f : callable
        The function that evaluates terms to be summed. The signature must be::

            f(x: ndarray, *args) -> ndarray

        where each element of ``x`` is a finite real and ``args`` is a tuple,
        which may contain an arbitrary number of arrays that are broadcastable
        with ``x``.

        `f` must be an elementwise function: each element ``f(x)[i]``
        must equal ``f(x[i])`` for all indices ``i``. It must not mutate the
        array ``x`` or the arrays in ``args``, and it must return NaN where
        the argument is NaN.

        `f` must represent a smooth, positive, unimodal function of `x` defined at
        *all reals* between `a` and `b`.
    a, b : float array_like
        Real lower and upper limits of summed terms. Must be broadcastable.
        Each element of `a` must be less than the corresponding element in `b`.
    step : float array_like
        Finite, positive, real step between summed terms. Must be broadcastable
        with `a` and `b`. Note that the number of terms included in the sum will
        be ``floor((b - a) / step)`` + 1; adjust `b` accordingly to ensure
        that ``f(b)`` is included if intended.
    args : tuple of array_like, optional
        Additional positional arguments to be passed to `f`. Must be arrays
        broadcastable with `a`, `b`, and `step`. If the callable to be summed
        requires arguments that are not broadcastable with `a`, `b`, and `step`,
        wrap that callable with `f` such that `f` accepts only `x` and
        broadcastable ``*args``. See Examples.
    log : bool, default: False
        Setting to True indicates that `f` returns the log of the terms
        and that `atol` and `rtol` are expressed as the logs of the absolute
        and relative errors. In this case, the result object will contain the
        log of the sum and error. This is useful for summands for which
        numerical underflow or overflow would lead to inaccuracies.
    maxterms : int, default: 2**20
        The maximum number of terms to evaluate for direct summation.
        Additional function evaluations may be performed for input
        validation and integral evaluation.
    atol, rtol : float, optional
        Absolute termination tolerance (default: 0) and relative termination
        tolerance (default: ``eps**0.5``, where ``eps`` is the precision of
        the result dtype), respectively. Must be non-negative
        and finite if `log` is False, and must be expressed as the log of a
        non-negative and finite number if `log` is True.

    Returns
    -------
    res : _RichResult
        An object similar to an instance of `scipy.optimize.OptimizeResult` with the
        following attributes. (The descriptions are written as though the values will
        be scalars; however, if `f` returns an array, the outputs will be
        arrays of the same shape.)

        success : bool
            ``True`` when the algorithm terminated successfully (status ``0``);
            ``False`` otherwise.
        status : int array
            An integer representing the exit status of the algorithm.

            - ``0`` : The algorithm converged to the specified tolerances.
            - ``-1`` : Element(s) of `a`, `b`, or `step` are invalid
            - ``-2`` : Numerical integration reached its iteration limit;
              the sum may be divergent.
            - ``-3`` : A non-finite value was encountered.
            - ``-4`` : The magnitude of the last term of the partial sum exceeds
              the tolerances, so the error estimate exceeds the tolerances.
              Consider increasing `maxterms` or loosening `tolerances`.
              Alternatively, the callable may not be unimodal, or the limits of
              summation may be too far from the function maximum. Consider
              increasing `maxterms` or breaking the sum into pieces.

        sum : float array
            An estimate of the sum.
        error : float array
            An estimate of the absolute error, assuming all terms are non-negative,
            the function is computed exactly, and direct summation is accurate to
            the precision of the result dtype.
        nfev : int array
            The number of points at which `f` was evaluated.

    See Also
    --------
    mpmath.nsum

    Notes
    -----
    The method implemented for infinite summation is related to the integral
    test for convergence of an infinite series: assuming `step` size 1 for
    simplicity of exposition, the sum of a monotone decreasing function is bounded by

    .. math::

        \int_u^\infty f(x) dx \leq \sum_{k=u}^\infty f(k) \leq \int_u^\infty f(x) dx + f(u)

    Let :math:`a` represent  `a`, :math:`n` represent `maxterms`, :math:`\epsilon_a`
    represent `atol`, and :math:`\epsilon_r` represent `rtol`.
    The implementation first evaluates the integral :math:`S_l=\int_a^\infty f(x) dx`
    as a lower bound of the infinite sum. Then, it seeks a value :math:`c > a` such
    that :math:`f(c) < \epsilon_a + S_l \epsilon_r`, if it exists; otherwise,
    let :math:`c = a + n`. Then the infinite sum is approximated as

    .. math::

        \sum_{k=a}^{c-1} f(k) + \int_c^\infty f(x) dx + f(c)/2

    and the reported error is :math:`f(c)/2` plus the error estimate of
    numerical integration. Note that the integral approximations may require
    evaluation of the function at points besides those that appear in the sum,
    so `f` must be a continuous and monotonically decreasing function defined
    for all reals within the integration interval. However, due to the nature
    of the integral approximation, the shape of the function between points
    that appear in the sum has little effect. If there is not a natural
    extension of the function to all reals, consider using linear interpolation,
    which is easy to evaluate and preserves monotonicity.

    The approach described above is generalized for non-unit
    `step` and finite `b` that is too large for direct evaluation of the sum,
    i.e. ``b - a + 1 > maxterms``. It is further generalized to unimodal
    functions by directly summing terms surrounding the maximum.
    This strategy may fail:

    - If the left limit is finite and the maximum is far from it.
    - If the right limit is finite and the maximum is far from it.
    - If both limits are finite and the maximum is far from the origin.

    In these cases, accuracy may be poor, and `nsum` may return status code ``4``.

    Although the callable `f` must be non-negative and unimodal,
    `nsum` can be used to evaluate more general forms of series. For instance, to
    evaluate an alternating series, pass a callable that returns the difference
    between pairs of adjacent terms, and adjust `step` accordingly. See Examples.

    References
    ----------
    .. [1] Wikipedia. "Integral test for convergence."
           https://en.wikipedia.org/wiki/Integral_test_for_convergence

    Examples
    --------
    Compute the infinite sum of the reciprocals of squared integers.

    >>> import numpy as np
    >>> from scipy.integrate import nsum
    >>> res = nsum(lambda k: 1/k**2, 1, np.inf)
    >>> ref = np.pi**2/6  # true value
    >>> res.error  # estimated error
    np.float64(7.448762306416137e-09)
    >>> (res.sum - ref)/ref  # true error
    np.float64(-1.839871898894426e-13)
    >>> res.nfev  # number of points at which callable was evaluated
    np.int32(8561)

    Compute the infinite sums of the reciprocals of integers raised to powers ``p``,
    where ``p`` is an array.

    >>> from scipy import special
    >>> p = np.arange(3, 10)
    >>> res = nsum(lambda k, p: 1/k**p, 1, np.inf, maxterms=1e3, args=(p,))
    >>> ref = special.zeta(p, 1)
    >>> np.allclose(res.sum, ref)
    True

    Evaluate the alternating harmonic series.

    >>> res = nsum(lambda x: 1/x - 1/(x+1), 1, np.inf, step=2)
    >>> res.sum, res.sum - np.log(2)  # result, difference vs analytical sum
    (np.float64(0.6931471805598691), np.float64(-7.616129948928574e-14))

    """ # noqa: E501
    # Potential future work:
    # - improve error estimate of `_direct` sum
    # - add other methods for convergence acceleration (Richardson, epsilon)
    # - support negative monotone increasing functions?
    # - b < a / negative step?
    # - complex-valued function?
    # - check for violations of monotonicity?

    # Function-specific input validation / standardization
    tmp = _nsum_iv(f, a, b, step, args, log, maxterms, tolerances)
    f, a, b, step, valid_abstep, args, log, maxterms, atol, rtol, xp = tmp

    # Additional elementwise algorithm input validation / standardization
    tmp = eim._initialize(f, (a,), args, complex_ok=False, xp=xp)
    f, xs, fs, args, shape, dtype, xp = tmp

    # Finish preparing `a`, `b`, and `step` arrays
    a = xs[0]
    b = xp.astype(xp_ravel(xp.broadcast_to(b, shape)), dtype)
    step = xp.astype(xp_ravel(xp.broadcast_to(step, shape)), dtype)
    valid_abstep = xp_ravel(xp.broadcast_to(valid_abstep, shape))
    nterms = xp.floor((b - a) / step)
    finite_terms = xp.isfinite(nterms)
    b[finite_terms] = a[finite_terms] + nterms[finite_terms]*step[finite_terms]

    # Define constants
    eps = xp.finfo(dtype).eps
    zero = xp.asarray(-xp.inf if log else 0, dtype=dtype)[()]
    if rtol is None:
        rtol = 0.5*math.log(eps) if log else eps**0.5
    constants = (dtype, log, eps, zero, rtol, atol, maxterms)

    # Prepare result arrays
    S = xp.empty_like(a)
    E = xp.empty_like(a)
    status = xp.zeros(len(a), dtype=xp.int32)
    nfev = xp.ones(len(a), dtype=xp.int32)  # one function evaluation above

    # Branch for direct sum evaluation / integral approximation / invalid input
    i0 = ~valid_abstep                     # invalid
    i0b = b < a                            # zero
    i1 = (nterms + 1 <= maxterms) & ~i0    # direct sum evaluation
    i2 = xp.isfinite(a) & ~i1 & ~i0        # infinite sum to the right
    i3 = xp.isfinite(b) & ~i2 & ~i1 & ~i0  # infinite sum to the left
    i4 = ~i3 & ~i2 & ~i1 & ~i0             # infinite sum on both sides

    if xp.any(i0):
        S[i0], E[i0] = xp.nan, xp.nan
        status[i0] = -1

        S[i0b], E[i0b] = zero, zero
        status[i0b] = 0

    if xp.any(i1):
        args_direct = [arg[i1] for arg in args]
        tmp = _direct(f, a[i1], b[i1], step[i1], args_direct, constants, xp)
        S[i1], E[i1] = tmp[:-1]
        nfev[i1] += tmp[-1]
        status[i1] = -3 * xp.asarray(~xp.isfinite(S[i1]), dtype=xp.int32)

    if xp.any(i2):
        args_indirect = [arg[i2] for arg in args]
        tmp = _integral_bound(f, a[i2], b[i2], step[i2],
                              args_indirect, constants, xp)
        S[i2], E[i2], status[i2] = tmp[:-1]
        nfev[i2] += tmp[-1]

    if xp.any(i3):
        args_indirect = [arg[i3] for arg in args]
        def _f(x, *args): return f(-x, *args)
        tmp = _integral_bound(_f, -b[i3], -a[i3], step[i3],
                              args_indirect, constants, xp)
        S[i3], E[i3], status[i3] = tmp[:-1]
        nfev[i3] += tmp[-1]

    if xp.any(i4):
        args_indirect = [arg[i4] for arg in args]

        # There are two obvious high-level strategies:
        # - Do two separate half-infinite sums (e.g. from -inf to 0 and 1 to inf)
        # - Make a callable that returns f(x) + f(-x) and do a single half-infinite sum
        # I thought the latter would have about half the overhead, so I went that way.
        # Then there are two ways of ensuring that f(0) doesn't get counted twice.
        # - Evaluate the sum from 1 to inf and add f(0)
        # - Evaluate the sum from 0 to inf and subtract f(0)
        # - Evaluate the sum from 0 to inf, but apply a weight of 0.5 when `x = 0`
        # The last option has more overhead, but is simpler to implement correctly
        # (especially getting the status message right)
        if log:
            def _f(x, *args):
                log_factor = xp.where(x==0, math.log(0.5), 0)
                out = xp.stack([f(x, *args), f(-x, *args)], axis=0)
                return special.logsumexp(out, axis=0) + log_factor

        else:
            def _f(x, *args):
                factor = xp.where(x==0, 0.5, 1)
                return (f(x, *args) + f(-x, *args)) * factor

        zero = xp.zeros_like(a[i4])
        tmp = _integral_bound(_f, zero, b[i4], step[i4], args_indirect, constants, xp)
        S[i4], E[i4], status[i4] = tmp[:-1]
        nfev[i4] += 2*tmp[-1]

    # Return results
    S, E = S.reshape(shape)[()], E.reshape(shape)[()]
    status, nfev = status.reshape(shape)[()], nfev.reshape(shape)[()]
    return _RichResult(sum=S, error=E, status=status, success=status == 0,
                       nfev=nfev)


def _direct(f, a, b, step, args, constants, xp, inclusive=True):
    # Directly evaluate the sum.

    # When used in the context of distributions, `args` would contain the
    # distribution parameters. We have broadcasted for simplicity, but we could
    # reduce function evaluations when distribution parameters are the same but
    # sum limits differ. Roughly:
    # - compute the function at all points between min(a) and max(b),
    # - compute the cumulative sum,
    # - take the difference between elements of the cumulative sum
    #   corresponding with b and a.
    # This is left to future enhancement

    dtype, log, eps, zero, _, _, _ = constants

    # To allow computation in a single vectorized call, find the maximum number
    # of points (over all slices) at which the function needs to be evaluated.
    # Note: if `inclusive` is `True`, then we want `1` more term in the sum.
    # I didn't think it was great style to use `True` as `1` in Python, so I
    # explicitly converted it to an `int` before using it.
    inclusive_adjustment = int(inclusive)
    steps = xp.round((b - a) / step) + inclusive_adjustment
    # Equivalently, steps = xp.round((b - a) / step) + inclusive
    max_steps = int(xp.max(steps))

    # In each slice, the function will be evaluated at the same number of points,
    # but excessive points (those beyond the right sum limit `b`) are replaced
    # with NaN to (potentially) reduce the time of these unnecessary calculations.
    # Use a new last axis for these calculations for consistency with other
    # elementwise algorithms.
    a2, b2, step2 = a[:, xp.newaxis], b[:, xp.newaxis], step[:, xp.newaxis]
    args2 = [arg[:, xp.newaxis] for arg in args]
    ks = a2 + xp.arange(max_steps, dtype=dtype) * step2
    i_nan = ks >= (b2 + inclusive_adjustment*step2/2)
    ks[i_nan] = xp.nan
    fs = f(ks, *args2)

    # The function evaluated at NaN is NaN, and NaNs are zeroed in the sum.
    # In some cases it may be faster to loop over slices than to vectorize
    # like this. This is an optimization that can be added later.
    fs[i_nan] = zero
    nfev = max_steps - i_nan.sum(axis=-1)
    S = special.logsumexp(fs, axis=-1) if log else xp.sum(fs, axis=-1)
    # Rough, non-conservative error estimate. See gh-19667 for improvement ideas.
    E = xp.real(S) + math.log(eps) if log else eps * abs(S)
    return S, E, nfev


def _integral_bound(f, a, b, step, args, constants, xp):
    # Estimate the sum with integral approximation
    dtype, log, _, _, rtol, atol, maxterms = constants
    log2 = xp.asarray(math.log(2), dtype=dtype)

    # Get a lower bound on the sum and compute effective absolute tolerance
    lb = tanhsinh(f, a, b, args=args, atol=atol, rtol=rtol, log=log)
    tol = xp.broadcast_to(xp.asarray(atol), lb.integral.shape)
    if log:
        tol = special.logsumexp(xp.stack((tol, rtol + lb.integral)), axis=0)
    else:
        tol = tol + rtol*lb.integral
    i_skip = lb.status == -3  # avoid unnecessary f_evals if integral is divergent
    tol[i_skip] = xp.nan
    status = lb.status

    # As in `_direct`, we'll need a temporary new axis for points
    # at which to evaluate the function. Append axis at the end for
    # consistency with other elementwise algorithms.
    a2 = a[..., xp.newaxis]
    step2 = step[..., xp.newaxis]
    args2 = [arg[..., xp.newaxis] for arg in args]

    # Find the location of a term that is less than the tolerance (if possible)
    log2maxterms = math.floor(math.log2(maxterms)) if maxterms else 0
    n_steps = xp.concat((2**xp.arange(0, log2maxterms), xp.asarray([maxterms])))
    n_steps = xp.astype(n_steps, dtype)
    nfev = len(n_steps) * 2
    ks = a2 + n_steps * step2
    fks = f(ks, *args2)
    fksp1 = f(ks + step2, *args2)  # check that the function is decreasing
    fk_insufficient = (fks > tol[:, xp.newaxis]) | (fksp1 > fks)
    n_fk_insufficient = xp.sum(fk_insufficient, axis=-1)
    nt = xp.minimum(n_fk_insufficient, n_steps.shape[-1]-1)
    n_steps = n_steps[nt]

    # If `maxterms` is insufficient (i.e. either the magnitude of the last term of the
    # partial sum exceeds the tolerance or the function is not decreasing), finish the
    # calculation, but report nonzero status. (Improvement: separate the status codes
    # for these two cases.)
    i_fk_insufficient = (n_fk_insufficient == nfev//2)

    # Directly evaluate the sum up to this term
    k = a + n_steps * step
    left, left_error, left_nfev = _direct(f, a, k, step, args,
                                          constants, xp, inclusive=False)
    left_is_pos_inf = xp.isinf(left) & (left > 0)
    i_skip |= left_is_pos_inf  # if sum is infinite, no sense in continuing
    status[left_is_pos_inf] = -3
    k[i_skip] = xp.nan

    # Use integration to estimate the remaining sum
    # Possible optimization for future work: if there were no terms less than
    # the tolerance, there is no need to compute the integral to better accuracy.
    # Something like:
    # atol = xp.maximum(atol, xp.minimum(fk/2 - fb/2))
    # rtol = xp.maximum(rtol, xp.minimum((fk/2 - fb/2)/left))
    # where `fk`/`fb` are currently calculated below.
    right = tanhsinh(f, k, b, args=args, atol=atol, rtol=rtol, log=log)

    # Calculate the full estimate and error from the pieces
    fk = fks[xp.arange(len(fks)), nt]

    # fb = f(b, *args), but some functions return NaN at infinity.
    # instead of 0 like they must (for the sum to be convergent).
    fb = xp.full_like(fk, -xp.inf) if log else xp.zeros_like(fk)
    i = xp.isfinite(b)
    if xp.any(i):  # better not call `f` with empty arrays
        fb[i] = f(b[i], *[arg[i] for arg in args])
    nfev = nfev + xp.asarray(i, dtype=left_nfev.dtype)

    if log:
        log_step = xp.log(step)
        S_terms = (left, right.integral - log_step, fk - log2, fb - log2)
        S = special.logsumexp(xp.stack(S_terms), axis=0)
        E_terms = (left_error, right.error - log_step, fk-log2, fb-log2+xp.pi*1j)
        E = xp.real(special.logsumexp(xp.stack(E_terms), axis=0))
    else:
        S = left + right.integral/step + fk/2 + fb/2
        E = left_error + right.error/step + fk/2 - fb/2
    status[~i_skip] = right.status[~i_skip]

    status[(status == 0) & i_fk_insufficient] = -4
    return S, E, status, left_nfev + right.nfev + nfev + lb.nfev
