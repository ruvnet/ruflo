import math
import numpy as np
import scipy._lib._elementwise_iterative_method as eim
from scipy._lib._util import _RichResult
from scipy._lib._array_api import xp_copy

# TODO:
# - (maybe?) don't use fancy indexing assignment
# - figure out how to replace the new `try`/`except`s


def _chandrupatla(func, a, b, *, args=(), xatol=None, xrtol=None,
                  fatol=None, frtol=0, maxiter=None, callback=None):
    """Find the root of an elementwise function using Chandrupatla's algorithm.

    For each element of the output of `func`, `chandrupatla` seeks the scalar
    root that makes the element 0. This function allows for `a`, `b`, and the
    output of `func` to be of any broadcastable shapes.

    Parameters
    ----------
    func : callable
        The function whose root is desired. The signature must be::

            func(x: ndarray, *args) -> ndarray

         where each element of ``x`` is a finite real and ``args`` is a tuple,
         which may contain an arbitrary number of components of any type(s).
         ``func`` must be an elementwise function: each element ``func(x)[i]``
         must equal ``func(x[i])`` for all indices ``i``. `_chandrupatla`
         seeks an array ``x`` such that ``func(x)`` is an array of zeros.
    a, b : array_like
        The lower and upper bounds of the root of the function. Must be
        broadcastable with one another.
    args : tuple, optional
        Additional positional arguments to be passed to `func`.
    xatol, xrtol, fatol, frtol : float, optional
        Absolute and relative tolerances on the root and function value.
        See Notes for details.
    maxiter : int, optional
        The maximum number of iterations of the algorithm to perform.
        The default is the maximum possible number of bisections within
        the (normal) floating point numbers of the relevant dtype.
    callback : callable, optional
        An optional user-supplied function to be called before the first
        iteration and after each iteration.
        Called as ``callback(res)``, where ``res`` is a ``_RichResult``
        similar to that returned by `_chandrupatla` (but containing the current
        iterate's values of all variables). If `callback` raises a
        ``StopIteration``, the algorithm will terminate immediately and
        `_chandrupatla` will return a result.

    Returns
    -------
    res : _RichResult
        An instance of `scipy._lib._util._RichResult` with the following
        attributes. The descriptions are written as though the values will be
        scalars; however, if `func` returns an array, the outputs will be
        arrays of the same shape.

        x : float
            The root of the function, if the algorithm terminated successfully.
        nfev : int
            The number of times the function was called to find the root.
        nit : int
            The number of iterations of Chandrupatla's algorithm performed.
        status : int
            An integer representing the exit status of the algorithm.
            ``0`` : The algorithm converged to the specified tolerances.
            ``-1`` : The algorithm encountered an invalid bracket.
            ``-2`` : The maximum number of iterations was reached.
            ``-3`` : A non-finite value was encountered.
            ``-4`` : Iteration was terminated by `callback`.
            ``1`` : The algorithm is proceeding normally (in `callback` only).
        success : bool
            ``True`` when the algorithm terminated successfully (status ``0``).
        fun : float
            The value of `func` evaluated at `x`.
        xl, xr : float
            The lower and upper ends of the bracket.
        fl, fr : float
            The function value at the lower and upper ends of the bracket.

    Notes
    -----
    Implemented based on Chandrupatla's original paper [1]_.

    If ``xl`` and ``xr`` are the left and right ends of the bracket,
    ``xmin = xl if abs(func(xl)) <= abs(func(xr)) else xr``,
    and ``fmin0 = min(func(a), func(b))``, then the algorithm is considered to
    have converged when ``abs(xr - xl) < xatol + abs(xmin) * xrtol`` or
    ``fun(xmin) <= fatol + abs(fmin0) * frtol``. This is equivalent to the
    termination condition described in [1]_ with ``xrtol = 4e-10``,
    ``xatol = 1e-5``, and ``fatol = frtol = 0``. The default values are
    ``xatol = 4*tiny``, ``xrtol = 4*eps``, ``frtol = 0``, and ``fatol = tiny``,
    where ``eps`` and ``tiny`` are the precision and smallest normal number
    of the result ``dtype`` of function inputs and outputs.

    References
    ----------

    .. [1] Chandrupatla, Tirupathi R.
        "A new hybrid quadratic/bisection algorithm for finding the zero of a
        nonlinear function without using derivatives".
        Advances in Engineering Software, 28(3), 145-149.
        https://doi.org/10.1016/s0965-9978(96)00051-8

    See Also
    --------
    brentq, brenth, ridder, bisect, newton

    Examples
    --------
    >>> from scipy import optimize
    >>> def f(x, c):
    ...     return x**3 - 2*x - c
    >>> c = 5
    >>> res = optimize._chandrupatla._chandrupatla(f, 0, 3, args=(c,))
    >>> res.x
    2.0945514818937463

    >>> c = [3, 4, 5]
    >>> res = optimize._chandrupatla._chandrupatla(f, 0, 3, args=(c,))
    >>> res.x
    array([1.8932892 , 2.        , 2.09455148])

    """
    res = _chandrupatla_iv(func, args, xatol, xrtol,
                           fatol, frtol, maxiter, callback)
    func, args, xatol, xrtol, fatol, frtol, maxiter, callback = res

    # Initialization
    temp = eim._initialize(func, (a, b), args)
    func, xs, fs, args, shape, dtype, xp = temp
    x1, x2 = xs
    f1, f2 = fs
    status = xp.full_like(x1, eim._EINPROGRESS,
                          dtype=xp.int32)  # in progress
    nit, nfev = 0, 2  # two function evaluations performed above
    finfo = xp.finfo(dtype)
    xatol = 4*finfo.smallest_normal if xatol is None else xatol
    xrtol = 4*finfo.eps if xrtol is None else xrtol
    fatol = finfo.smallest_normal if fatol is None else fatol
    frtol = frtol * xp.minimum(xp.abs(f1), xp.abs(f2))
    maxiter = (math.log2(finfo.max) - math.log2(finfo.smallest_normal)
               if maxiter is None else maxiter)
    work = _RichResult(x1=x1, f1=f1, x2=x2, f2=f2, x3=None, f3=None, t=0.5,
                       xatol=xatol, xrtol=xrtol, fatol=fatol, frtol=frtol,
                       nit=nit, nfev=nfev, status=status)
    res_work_pairs = [('status', 'status'), ('x', 'xmin'), ('fun', 'fmin'),
                      ('nit', 'nit'), ('nfev', 'nfev'), ('xl', 'x1'),
                      ('fl', 'f1'), ('xr', 'x2'), ('fr', 'f2')]

    def pre_func_eval(work):
        # [1] Figure 1 (first box)
        x = work.x1 + work.t * (work.x2 - work.x1)
        return x

    def post_func_eval(x, f, work):
        # [1] Figure 1 (first diamond and boxes)
        # Note: y/n are reversed in figure; compare to BASIC in appendix
        work.x3, work.f3 = (xp.asarray(work.x2, copy=True),
                            xp.asarray(work.f2, copy=True))
        j = xp.sign(f) == xp.sign(work.f1)
        nj = ~j
        work.x3[j], work.f3[j] = work.x1[j], work.f1[j]
        work.x2[nj], work.f2[nj] = work.x1[nj], work.f1[nj]
        work.x1, work.f1 = x, f

    def check_termination(work):
        # [1] Figure 1 (second diamond)
        # Check for all terminal conditions and record statuses.

        # See [1] Section 4 (first two sentences)
        i = xp.abs(work.f1) < xp.abs(work.f2)
        work.xmin = xp.where(i, work.x1, work.x2)
        work.fmin = xp.where(i, work.f1, work.f2)
        stop = xp.zeros_like(work.x1, dtype=xp.bool)  # termination condition met

        # If function value tolerance is met, report successful convergence,
        # regardless of other conditions. Note that `frtol` has been redefined
        # as `frtol = frtol * minimum(f1, f2)`, where `f1` and `f2` are the
        # function evaluated at the original ends of the bracket.
        i = xp.abs(work.fmin) <= work.fatol + work.frtol
        work.status[i] = eim._ECONVERGED
        stop[i] = True

        # If the bracket is no longer valid, report failure (unless a function
        # tolerance is met, as detected above).
        i = (xp.sign(work.f1) == xp.sign(work.f2)) & ~stop
        NaN = xp.asarray(xp.nan, dtype=work.xmin.dtype)
        work.xmin[i], work.fmin[i], work.status[i] = NaN, NaN, eim._ESIGNERR
        stop[i] = True

        # If the abscissae are non-finite or either function value is NaN,
        # report failure.
        x_nonfinite = ~(xp.isfinite(work.x1) & xp.isfinite(work.x2))
        f_nan = xp.isnan(work.f1) & xp.isnan(work.f2)
        i = (x_nonfinite | f_nan) & ~stop
        work.xmin[i], work.fmin[i], work.status[i] = NaN, NaN, eim._EVALUEERR
        stop[i] = True

        # This is the convergence criterion used in bisect. Chandrupatla's
        # criterion is equivalent to this except with a factor of 4 on `xrtol`.
        work.dx = xp.abs(work.x2 - work.x1)
        work.tol = xp.abs(work.xmin) * work.xrtol + work.xatol
        i = work.dx < work.tol
        work.status[i] = eim._ECONVERGED
        stop[i] = True

        return stop

    def post_termination_check(work):
        # [1] Figure 1 (third diamond and boxes / Equation 1)
        xi1 = (work.x1 - work.x2) / (work.x3 - work.x2)
        with np.errstate(divide='ignore', invalid='ignore'):
            phi1 = (work.f1 - work.f2) / (work.f3 - work.f2)
        alpha = (work.x3 - work.x1) / (work.x2 - work.x1)
        j = ((1 - xp.sqrt(1 - xi1)) < phi1) & (phi1 < xp.sqrt(xi1))

        f1j, f2j, f3j, alphaj = work.f1[j], work.f2[j], work.f3[j], alpha[j]
        t = xp.full_like(alpha, 0.5)
        t[j] = (f1j / (f1j - f2j) * f3j / (f3j - f2j)
                - alphaj * f1j / (f3j - f1j) * f2j / (f2j - f3j))

        # [1] Figure 1 (last box; see also BASIC in appendix with comment
        # "Adjust T Away from the Interval Boundary")
        tl = 0.5 * work.tol / work.dx
        work.t = xp.clip(t, tl, 1 - tl)

    def customize_result(res, shape):
        xl, xr, fl, fr = res['xl'], res['xr'], res['fl'], res['fr']
        i = res['xl'] < res['xr']
        res['xl'] = xp.where(i, xl, xr)
        res['xr'] = xp.where(i, xr, xl)
        res['fl'] = xp.where(i, fl, fr)
        res['fr'] = xp.where(i, fr, fl)
        return shape

    return eim._loop(work, callback, shape, maxiter, func, args, dtype,
                     pre_func_eval, post_func_eval, check_termination,
                     post_termination_check, customize_result, res_work_pairs,
                     xp=xp)


def _chandrupatla_iv(func, args, xatol, xrtol,
                     fatol, frtol, maxiter, callback):
    # Input validation for `_chandrupatla`

    if not callable(func):
        raise ValueError('`func` must be callable.')

    if not np.iterable(args):
        args = (args,)

    # tolerances are floats, not arrays; OK to use NumPy
    tols = np.asarray([xatol if xatol is not None else 1,
                       xrtol if xrtol is not None else 1,
                       fatol if fatol is not None else 1,
                       frtol if frtol is not None else 1])
    if (not np.issubdtype(tols.dtype, np.number) or np.any(tols < 0)
            or np.any(np.isnan(tols)) or tols.shape != (4,)):
        raise ValueError('Tolerances must be non-negative scalars.')

    if maxiter is not None:
        maxiter_int = int(maxiter)
        if maxiter != maxiter_int or maxiter < 0:
            raise ValueError('`maxiter` must be a non-negative integer.')

    if callback is not None and not callable(callback):
        raise ValueError('`callback` must be callable.')

    return func, args, xatol, xrtol, fatol, frtol, maxiter, callback


def _chandrupatla_minimize(func, x1, x2, x3, *, args=(), xatol=None,
                           xrtol=None, fatol=None, frtol=None, maxiter=100,
                           callback=None):
    """Find the minimizer of an elementwise function.

    For each element of the output of `func`, `_chandrupatla_minimize` seeks
    the scalar minimizer that minimizes the element. This function allows for
    `x1`, `x2`, `x3`, and the elements of `args` to be arrays of any
    broadcastable shapes.

    Parameters
    ----------
    func : callable
        The function whose minimizer is desired. The signature must be::

            func(x: ndarray, *args) -> ndarray

         where each element of ``x`` is a finite real and ``args`` is a tuple,
         which may contain an arbitrary number of arrays that are broadcastable
         with `x`. ``func`` must be an elementwise function: each element
         ``func(x)[i]`` must equal ``func(x[i])`` for all indices ``i``.
         `_chandrupatla` seeks an array ``x`` such that ``func(x)`` is an array
         of minima.
    x1, x2, x3 : array_like
        The abscissae of a standard scalar minimization bracket. A bracket is
        valid if ``x1 < x2 < x3`` and ``func(x1) > func(x2) <= func(x3)``.
        Must be broadcastable with one another and `args`.
    args : tuple, optional
        Additional positional arguments to be passed to `func`.  Must be arrays
        broadcastable with `x1`, `x2`, and `x3`. If the callable to be
        differentiated requires arguments that are not broadcastable with `x`,
        wrap that callable with `func` such that `func` accepts only `x` and
        broadcastable arrays.
    xatol, xrtol, fatol, frtol : float, optional
        Absolute and relative tolerances on the minimizer and function value.
        See Notes for details.
    maxiter : int, optional
        The maximum number of iterations of the algorithm to perform.
    callback : callable, optional
        An optional user-supplied function to be called before the first
        iteration and after each iteration.
        Called as ``callback(res)``, where ``res`` is a ``_RichResult``
        similar to that returned by `_chandrupatla_minimize` (but containing
        the current iterate's values of all variables). If `callback` raises a
        ``StopIteration``, the algorithm will terminate immediately and
        `_chandrupatla_minimize` will return a result.

    Returns
    -------
    res : _RichResult
        An instance of `scipy._lib._util._RichResult` with the following
        attributes. (The descriptions are written as though the values will be
        scalars; however, if `func` returns an array, the outputs will be
        arrays of the same shape.)

        success : bool
            ``True`` when the algorithm terminated successfully (status ``0``).
        status : int
            An integer representing the exit status of the algorithm.
            ``0`` : The algorithm converged to the specified tolerances.
            ``-1`` : The algorithm encountered an invalid bracket.
            ``-2`` : The maximum number of iterations was reached.
            ``-3`` : A non-finite value was encountered.
            ``-4`` : Iteration was terminated by `callback`.
            ``1`` : The algorithm is proceeding normally (in `callback` only).
        x : float
            The minimizer of the function, if the algorithm terminated
            successfully.
        fun : float
            The value of `func` evaluated at `x`.
        nfev : int
            The number of points at which `func` was evaluated.
        nit : int
            The number of iterations of the algorithm that were performed.
        xl, xm, xr : float
            The final three-point bracket.
        fl, fm, fr : float
            The function value at the bracket points.

    Notes
    -----
    Implemented based on Chandrupatla's original paper [1]_.

    If ``x1 < x2 < x3`` are the points of the bracket and ``f1 > f2 <= f3``
    are the values of ``func`` at those points, then the algorithm is
    considered to have converged when ``x3 - x1 <= abs(x2)*xrtol + xatol``
    or ``(f1 - 2*f2 + f3)/2 <= abs(f2)*frtol + fatol``. Note that first of
    these differs from the termination conditions described in [1]_. The
    default values of `xrtol` is the square root of the precision of the
    appropriate dtype, and ``xatol = fatol = frtol`` is the smallest normal
    number of the appropriate dtype.

    References
    ----------
    .. [1] Chandrupatla, Tirupathi R. (1998).
        "An efficient quadratic fit-sectioning algorithm for minimization
        without derivatives".
        Computer Methods in Applied Mechanics and Engineering, 152 (1-2),
        211-217. https://doi.org/10.1016/S0045-7825(97)00190-4

    See Also
    --------
    golden, brent, bounded

    Examples
    --------
    >>> from scipy.optimize._chandrupatla import _chandrupatla_minimize
    >>> def f(x, args=1):
    ...     return (x - args)**2
    >>> res = _chandrupatla_minimize(f, -5, 0, 5)
    >>> res.x
    1.0
    >>> c = [1, 1.5, 2]
    >>> res = _chandrupatla_minimize(f, -5, 0, 5, args=(c,))
    >>> res.x
    array([1. , 1.5, 2. ])
    """
    res = _chandrupatla_iv(func, args, xatol, xrtol,
                           fatol, frtol, maxiter, callback)
    func, args, xatol, xrtol, fatol, frtol, maxiter, callback = res

    # Initialization
    xs = (x1, x2, x3)
    temp = eim._initialize(func, xs, args)
    func, xs, fs, args, shape, dtype, xp = temp  # line split for PEP8
    x1, x2, x3 = xs
    f1, f2, f3 = fs
    phi = xp.asarray(0.5 + 0.5*5**0.5, dtype=dtype)[()]  # golden ratio
    status = xp.full_like(x1, eim._EINPROGRESS, dtype=xp.int32)  # in progress
    nit, nfev = 0, 3  # three function evaluations performed above
    fatol = xp.finfo(dtype).smallest_normal if fatol is None else fatol
    frtol = xp.finfo(dtype).smallest_normal if frtol is None else frtol
    xatol = xp.finfo(dtype).smallest_normal if xatol is None else xatol
    xrtol = math.sqrt(xp.finfo(dtype).eps) if xrtol is None else xrtol

    # Ensure that x1 < x2 < x3 initially.
    xs, fs = xp.stack((x1, x2, x3)), xp.stack((f1, f2, f3))
    i = xp.argsort(xs, axis=0)
    x1, x2, x3 = xp.take_along_axis(xs, i, axis=0)  # data-apis/array-api#808
    f1, f2, f3 = xp.take_along_axis(fs, i, axis=0)  # data-apis/array-api#808
    q0 = xp_copy(x3)  # "At the start, q0 is set at x3..." ([1] after (7))

    work = _RichResult(x1=x1, f1=f1, x2=x2, f2=f2, x3=x3, f3=f3, phi=phi,
                       xatol=xatol, xrtol=xrtol, fatol=fatol, frtol=frtol,
                       nit=nit, nfev=nfev, status=status, q0=q0, args=args)
    res_work_pairs = [('status', 'status'),
                      ('x', 'x2'), ('fun', 'f2'),
                      ('nit', 'nit'), ('nfev', 'nfev'),
                      ('xl', 'x1'), ('xm', 'x2'), ('xr', 'x3'),
                      ('fl', 'f1'), ('fm', 'f2'), ('fr', 'f3')]

    def pre_func_eval(work):
        # `_check_termination` is called first -> `x3 - x2 > x2 - x1`
        # But let's calculate a few terms that we'll reuse
        x21 = work.x2 - work.x1
        x32 = work.x3 - work.x2

        # [1] Section 3. "The quadratic minimum point Q1 is calculated using
        # the relations developed in the previous section." [1] Section 2 (5/6)
        A = x21 * (work.f3 - work.f2)
        B = x32 * (work.f1 - work.f2)
        C = A / (A + B)
        # q1 = C * (work.x1 + work.x2) / 2 + (1 - C) * (work.x2 + work.x3) / 2
        q1 = 0.5 * (C*(work.x1 - work.x3) + work.x2 + work.x3)  # much faster
        # this is an array, so multiplying by 0.5 does not change dtype

        # "If Q1 and Q0 are sufficiently close... Q1 is accepted if it is
        # sufficiently away from the inside point x2"
        i = xp.abs(q1 - work.q0) < 0.5 * xp.abs(x21)  # [1] (7)
        xi = q1[i]
        # Later, after (9), "If the point Q1 is in a +/- xtol neighborhood of
        # x2, the new point is chosen in the larger interval at a distance
        # tol away from x2."
        # See also QBASIC code after "Accept Ql adjust if close to X2".
        j = xp.abs(q1[i] - work.x2[i]) <= work.xtol[i]
        xi[j] = work.x2[i][j] + xp.sign(x32[i][j]) * work.xtol[i][j]

        # "If condition (7) is not satisfied, golden sectioning of the larger
        # interval is carried out to introduce the new point."
        # (For simplicity, we go ahead and calculate it for all points, but we
        # change the elements for which the condition was satisfied.)
        x = work.x2 + (2 - work.phi) * x32
        x[i] = xi

        # "We define Q0 as the value of Q1 at the previous iteration."
        work.q0 = q1
        return x

    def post_func_eval(x, f, work):
        # Standard logic for updating a three-point bracket based on a new
        # point. In QBASIC code, see "IF SGN(X-X2) = SGN(X3-X2) THEN...".
        # There is an awful lot of data copying going on here; this would
        # probably benefit from code optimization or implementation in Pythran.
        i = xp.sign(x - work.x2) == xp.sign(work.x3 - work.x2)
        xi, x1i, x2i, x3i = x[i], work.x1[i], work.x2[i], work.x3[i],
        fi, f1i, f2i, f3i = f[i], work.f1[i], work.f2[i], work.f3[i]
        j = fi > f2i
        x3i[j], f3i[j] = xi[j], fi[j]
        j = ~j
        x1i[j], f1i[j], x2i[j], f2i[j] = x2i[j], f2i[j], xi[j], fi[j]

        ni = ~i
        xni, x1ni, x2ni, x3ni = x[ni], work.x1[ni], work.x2[ni], work.x3[ni],
        fni, f1ni, f2ni, f3ni = f[ni], work.f1[ni], work.f2[ni], work.f3[ni]
        j = fni > f2ni
        x1ni[j], f1ni[j] = xni[j], fni[j]
        j = ~j
        x3ni[j], f3ni[j], x2ni[j], f2ni[j] = x2ni[j], f2ni[j], xni[j], fni[j]

        work.x1[i], work.x2[i], work.x3[i] = x1i, x2i, x3i
        work.f1[i], work.f2[i], work.f3[i] = f1i, f2i, f3i
        work.x1[ni], work.x2[ni], work.x3[ni] = x1ni, x2ni, x3ni,
        work.f1[ni], work.f2[ni], work.f3[ni] = f1ni, f2ni, f3ni

    def check_termination(work):
        # Check for all terminal conditions and record statuses.
        stop = xp.zeros_like(work.x1, dtype=bool)  # termination condition met

        # Bracket is invalid; stop and don't return minimizer/minimum
        i = ((work.f2 > work.f1) | (work.f2 > work.f3))
        work.x2[i], work.f2[i] = xp.nan, xp.nan
        stop[i], work.status[i] = True, eim._ESIGNERR

        # Non-finite values; stop and don't return minimizer/minimum
        finite = xp.isfinite(work.x1+work.x2+work.x3+work.f1+work.f2+work.f3)
        i = ~(finite | stop)
        work.x2[i], work.f2[i] = xp.nan, xp.nan
        stop[i], work.status[i] = True, eim._EVALUEERR

        # [1] Section 3 "Points 1 and 3 are interchanged if necessary to make
        # the (x2, x3) the larger interval."
        # Note: I had used np.choose; this is much faster. This would be a good
        # place to save e.g. `work.x3 - work.x2` for reuse, but I tried and
        # didn't notice a speed boost, so let's keep it simple.
        i = xp.abs(work.x3 - work.x2) < xp.abs(work.x2 - work.x1)
        temp = work.x1[i]
        work.x1[i] = work.x3[i]
        work.x3[i] = temp
        temp = work.f1[i]
        work.f1[i] = work.f3[i]
        work.f3[i] = temp

        # [1] Section 3 (bottom of page 212)
        # "We set a tolerance value xtol..."
        work.xtol = xp.abs(work.x2) * work.xrtol + work.xatol  # [1] (8)
        # "The convergence based on interval is achieved when..."
        # Note: Equality allowed in case of `xtol=0`
        i = xp.abs(work.x3 - work.x2) <= 2 * work.xtol  # [1] (9)

        # "We define ftol using..."
        ftol = xp.abs(work.f2) * work.frtol + work.fatol  # [1] (10)
        # "The convergence based on function values is achieved when..."
        # Note 1: modify in place to incorporate tolerance on function value.
        # Note 2: factor of 2 is not in the text; see QBASIC start of DO loop
        i |= (work.f1 - 2 * work.f2 + work.f3) <= 2*ftol  # [1] (11)
        i &= ~stop
        stop[i], work.status[i] = True, eim._ECONVERGED

        return stop

    def post_termination_check(work):
        pass

    def customize_result(res, shape):
        xl, xr, fl, fr = res['xl'], res['xr'], res['fl'], res['fr']
        i = res['xl'] >= res['xr']
        res['xl'] = xp.where(i, xr, xl)
        res['xr'] = xp.where(i, xl, xr)
        res['fl'] = xp.where(i, fr, fl)
        res['fr'] = xp.where(i, fl, fr)
        return shape

    return eim._loop(work, callback, shape, maxiter, func, args, dtype,
                     pre_func_eval, post_func_eval, check_termination,
                     post_termination_check, customize_result, res_work_pairs,
                     xp=xp)
