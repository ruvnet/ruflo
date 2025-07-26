import numpy as np
import scipy._lib._elementwise_iterative_method as eim
from scipy._lib._util import _RichResult
from scipy._lib._array_api import array_namespace, xp_ravel, xp_promote

_ELIMITS = -1  # used in _bracket_root
_ESTOPONESIDE = 2  # used in _bracket_root

def _bracket_root_iv(func, xl0, xr0, xmin, xmax, factor, args, maxiter):

    if not callable(func):
        raise ValueError('`func` must be callable.')

    if not np.iterable(args):
        args = (args,)

    xp = array_namespace(xl0, xr0, xmin, xmax, factor, *args)

    # If xr0 is not supplied, fill with a dummy value for the sake of
    # broadcasting. We need to wait until xmax has been validated to
    # compute the default value.
    xr0_not_supplied = False
    if xr0 is None:
        xr0 = xp.nan
        xr0_not_supplied = True

    xmin = -xp.inf if xmin is None else xmin
    xmax = xp.inf if xmax is None else xmax
    factor = 2. if factor is None else factor
    xl0, xr0, xmin, xmax, factor = xp_promote(
        xl0, xr0, xmin, xmax, factor, broadcast=True, force_floating=True, xp=xp)

    if not xp.isdtype(xl0.dtype, ('integral', 'real floating')):
        raise ValueError('`xl0` must be numeric and real.')

    if (not xp.isdtype(xr0.dtype, "numeric")
        or xp.isdtype(xr0.dtype, "complex floating")):
        raise ValueError('`xr0` must be numeric and real.')

    if (not xp.isdtype(xmin.dtype, "numeric")
        or xp.isdtype(xmin.dtype, "complex floating")):
        raise ValueError('`xmin` must be numeric and real.')

    if (not xp.isdtype(xmax.dtype, "numeric")
        or xp.isdtype(xmax.dtype, "complex floating")):
        raise ValueError('`xmax` must be numeric and real.')

    if (not xp.isdtype(factor.dtype, "numeric")
        or xp.isdtype(factor.dtype, "complex floating")):
        raise ValueError('`factor` must be numeric and real.')
    if not xp.all(factor > 1):
        raise ValueError('All elements of `factor` must be greater than 1.')

    # Calculate the default value of xr0 if a value has not been supplied.
    # Be careful to ensure xr0 is not larger than xmax.
    if xr0_not_supplied:
        xr0 = xl0 + xp.minimum((xmax - xl0)/ 8, 1.0)
        xr0 = xp.astype(xr0, xl0.dtype, copy=False)

    maxiter = xp.asarray(maxiter)
    message = '`maxiter` must be a non-negative integer.'
    if (not xp.isdtype(maxiter.dtype, "numeric") or maxiter.shape != tuple()
            or xp.isdtype(maxiter.dtype, "complex floating")):
        raise ValueError(message)
    maxiter_int = int(maxiter[()])
    if not maxiter == maxiter_int or maxiter < 0:
        raise ValueError(message)

    return func, xl0, xr0, xmin, xmax, factor, args, maxiter, xp


def _bracket_root(func, xl0, xr0=None, *, xmin=None, xmax=None, factor=None,
                  args=(), maxiter=1000):
    """Bracket the root of a monotonic scalar function of one variable

    This function works elementwise when `xl0`, `xr0`, `xmin`, `xmax`, `factor`, and
    the elements of `args` are broadcastable arrays.

    Parameters
    ----------
    func : callable
        The function for which the root is to be bracketed.
        The signature must be::

            func(x: ndarray, *args) -> ndarray

        where each element of ``x`` is a finite real and ``args`` is a tuple,
        which may contain an arbitrary number of arrays that are broadcastable
        with `x`. ``func`` must be an elementwise function: each element
        ``func(x)[i]`` must equal ``func(x[i])`` for all indices ``i``.
    xl0, xr0: float array_like
        Starting guess of bracket, which need not contain a root. If `xr0` is
        not provided, ``xr0 = xl0 + 1``. Must be broadcastable with one another.
    xmin, xmax : float array_like, optional
        Minimum and maximum allowable endpoints of the bracket, inclusive. Must
        be broadcastable with `xl0` and `xr0`.
    factor : float array_like, default: 2
        The factor used to grow the bracket. See notes for details.
    args : tuple, optional
        Additional positional arguments to be passed to `func`.  Must be arrays
        broadcastable with `xl0`, `xr0`, `xmin`, and `xmax`. If the callable to be
        bracketed requires arguments that are not broadcastable with these
        arrays, wrap that callable with `func` such that `func` accepts
        only `x` and broadcastable arrays.
    maxiter : int, optional
        The maximum number of iterations of the algorithm to perform.

    Returns
    -------
    res : _RichResult
        An instance of `scipy._lib._util._RichResult` with the following
        attributes. The descriptions are written as though the values will be
        scalars; however, if `func` returns an array, the outputs will be
        arrays of the same shape.

        xl, xr : float
            The lower and upper ends of the bracket, if the algorithm
            terminated successfully.
        fl, fr : float
            The function value at the lower and upper ends of the bracket.
        nfev : int
            The number of function evaluations required to find the bracket.
            This is distinct from the number of times `func` is *called*
            because the function may evaluated at multiple points in a single
            call.
        nit : int
            The number of iterations of the algorithm that were performed.
        status : int
            An integer representing the exit status of the algorithm.

            - ``0`` : The algorithm produced a valid bracket.
            - ``-1`` : The bracket expanded to the allowable limits without finding a bracket.
            - ``-2`` : The maximum number of iterations was reached.
            - ``-3`` : A non-finite value was encountered.
            - ``-4`` : Iteration was terminated by `callback`.
            - ``-5``: The initial bracket does not satisfy `xmin <= xl0 < xr0 < xmax`.
            - ``1`` : The algorithm is proceeding normally (in `callback` only).
            - ``2`` : A bracket was found in the opposite search direction (in `callback` only).

        success : bool
            ``True`` when the algorithm terminated successfully (status ``0``).

    Notes
    -----
    This function generalizes an algorithm found in pieces throughout
    `scipy.stats`. The strategy is to iteratively grow the bracket ``(l, r)``
     until ``func(l) < 0 < func(r)``. The bracket grows to the left as follows.

    - If `xmin` is not provided, the distance between `xl0` and `l` is iteratively
      increased by `factor`.
    - If `xmin` is provided, the distance between `xmin` and `l` is iteratively
      decreased by `factor`. Note that this also *increases* the bracket size.

    Growth of the bracket to the right is analogous.

    Growth of the bracket in one direction stops when the endpoint is no longer
    finite, the function value at the endpoint is no longer finite, or the
    endpoint reaches its limiting value (`xmin` or `xmax`). Iteration terminates
    when the bracket stops growing in both directions, the bracket surrounds
    the root, or a root is found (accidentally).

    If two brackets are found - that is, a bracket is found on both sides in
    the same iteration, the smaller of the two is returned.
    If roots of the function are found, both `l` and `r` are set to the
    leftmost root.

    """  # noqa: E501
    # Todo:
    # - find bracket with sign change in specified direction
    # - Add tolerance
    # - allow factor < 1?

    callback = None  # works; I just don't want to test it
    temp = _bracket_root_iv(func, xl0, xr0, xmin, xmax, factor, args, maxiter)
    func, xl0, xr0, xmin, xmax, factor, args, maxiter, xp = temp

    xs = (xl0, xr0)
    temp = eim._initialize(func, xs, args)
    func, xs, fs, args, shape, dtype, xp = temp  # line split for PEP8
    xl0, xr0 = xs
    xmin = xp_ravel(xp.astype(xp.broadcast_to(xmin, shape), dtype, copy=False), xp=xp)
    xmax = xp_ravel(xp.astype(xp.broadcast_to(xmax, shape), dtype, copy=False), xp=xp)
    invalid_bracket = ~((xmin <= xl0) & (xl0 < xr0) & (xr0 <= xmax))

    # The approach is to treat the left and right searches as though they were
    # (almost) totally independent one-sided bracket searches. (The interaction
    # is considered when checking for termination and preparing the result
    # object.)
    # `x` is the "moving" end of the bracket
    x = xp.concat(xs)
    f = xp.concat(fs)
    invalid_bracket = xp.concat((invalid_bracket, invalid_bracket))
    n = x.shape[0] // 2

    # `x_last` is the previous location of the moving end of the bracket. If
    # the signs of `f` and `f_last` are different, `x` and `x_last` form a
    # bracket.
    x_last = xp.concat((x[n:], x[:n]))
    f_last = xp.concat((f[n:], f[:n]))
    # `x0` is the "fixed" end of the bracket.
    x0 = x_last
    # We don't need to retain the corresponding function value, since the
    # fixed end of the bracket is only needed to compute the new value of the
    # moving end; it is never returned.
    limit = xp.concat((xmin, xmax))

    factor = xp_ravel(xp.broadcast_to(factor, shape), xp=xp)
    factor = xp.astype(factor, dtype, copy=False)
    factor = xp.concat((factor, factor))

    active = xp.arange(2*n)
    args = [xp.concat((arg, arg)) for arg in args]

    # This is needed due to inner workings of `eim._loop`.
    # We're abusing it a tiny bit.
    shape = shape + (2,)

    # `d` is for "distance".
    # For searches without a limit, the distance between the fixed end of the
    # bracket `x0` and the moving end `x` will grow by `factor` each iteration.
    # For searches with a limit, the distance between the `limit` and moving
    # end of the bracket `x` will shrink by `factor` each iteration.
    i = xp.isinf(limit)
    ni = ~i
    d = xp.zeros_like(x)
    d[i] = x[i] - x0[i]
    d[ni] = limit[ni] - x[ni]

    status = xp.full_like(x, eim._EINPROGRESS, dtype=xp.int32)  # in progress
    status[invalid_bracket] = eim._EINPUTERR
    nit, nfev = 0, 1  # one function evaluation per side performed above

    work = _RichResult(x=x, x0=x0, f=f, limit=limit, factor=factor,
                       active=active, d=d, x_last=x_last, f_last=f_last,
                       nit=nit, nfev=nfev, status=status, args=args,
                       xl=xp.nan, xr=xp.nan, fl=xp.nan, fr=xp.nan, n=n)
    res_work_pairs = [('status', 'status'), ('xl', 'xl'), ('xr', 'xr'),
                      ('nit', 'nit'), ('nfev', 'nfev'), ('fl', 'fl'),
                      ('fr', 'fr'), ('x', 'x'), ('f', 'f'),
                      ('x_last', 'x_last'), ('f_last', 'f_last')]

    def pre_func_eval(work):
        # Initialize moving end of bracket
        x = xp.zeros_like(work.x)

        # Unlimited brackets grow by `factor` by increasing distance from fixed
        # end to moving end.
        i = xp.isinf(work.limit)  # indices of unlimited brackets
        work.d[i] *= work.factor[i]
        x[i] = work.x0[i] + work.d[i]

        # Limited brackets grow by decreasing the distance from the limit to
        # the moving end.
        ni = ~i  # indices of limited brackets
        work.d[ni] /= work.factor[ni]
        x[ni] = work.limit[ni] - work.d[ni]

        return x

    def post_func_eval(x, f, work):
        # Keep track of the previous location of the moving end so that we can
        # return a narrower bracket. (The alternative is to remember the
        # original fixed end, but then the bracket would be wider than needed.)
        work.x_last = work.x
        work.f_last = work.f
        work.x = x
        work.f = f

    def check_termination(work):
        # Condition 0: initial bracket is invalid
        stop = (work.status == eim._EINPUTERR)

        # Condition 1: a valid bracket (or the root itself) has been found
        sf = xp.sign(work.f)
        sf_last = xp.sign(work.f_last)
        i = ((sf_last == -sf) | (sf_last == 0) | (sf == 0)) & ~stop
        work.status[i] = eim._ECONVERGED
        stop[i] = True

        # Condition 2: the other side's search found a valid bracket.
        # (If we just found a bracket with the rightward search, we can stop
        #  the leftward search, and vice-versa.)
        # To do this, we need to set the status of the other side's search;
        # this is tricky because `work.status` contains only the *active*
        # elements, so we don't immediately know the index of the element we
        # need to set - or even if it's still there. (That search may have
        # terminated already, e.g. by reaching its `limit`.)
        # To facilitate this, `work.active` contains a unit integer index of
        # each search. Index `k` (`k < n)` and `k + n` correspond with a
        # leftward and rightward search, respectively. Elements are removed
        # from `work.active` just as they are removed from `work.status`, so
        # we use `work.active` to help find the right location in
        # `work.status`.
        # Get the integer indices of the elements that can also stop
        also_stop = (work.active[i] + work.n) % (2*work.n)
        # Check whether they are still active. We want to find the indices
        # in work.active where the associated values in work.active are
        # contained in also_stop. xp.searchsorted let's us take advantage
        # of work.active being sorted, but requires some hackery because
        # searchsorted solves the separate but related problem of finding
        # the indices where the values in also_stop should be added to
        # maintain sorted order.
        j = xp.searchsorted(work.active, also_stop)
        # If the location exceeds the length of the `work.active`, they are
        # not there. This happens when a value in also_stop is larger than
        # the greatest value in work.active. This case needs special handling
        # because we cannot simply check that also_stop == work.active[j].
        mask = j < work.active.shape[0]
        # Note that we also have to use the mask to filter also_stop to ensure
        # that also_stop and j will still have the same shape.
        j, also_stop = j[mask], also_stop[mask]
        j = j[also_stop == work.active[j]]
        # Now convert these to boolean indices to use with `work.status`.
        i = xp.zeros_like(stop)
        i[j] = True  # boolean indices of elements that can also stop
        i = i & ~stop
        work.status[i] = _ESTOPONESIDE
        stop[i] = True

        # Condition 3: moving end of bracket reaches limit
        i = (work.x == work.limit) & ~stop
        work.status[i] = _ELIMITS
        stop[i] = True

        # Condition 4: non-finite value encountered
        i = ~(xp.isfinite(work.x) & xp.isfinite(work.f)) & ~stop
        work.status[i] = eim._EVALUEERR
        stop[i] = True

        return stop

    def post_termination_check(work):
        pass

    def customize_result(res, shape):
        n = res['x'].shape[0] // 2

        # To avoid ambiguity, below we refer to `xl0`, the initial left endpoint
        # as `a` and `xr0`, the initial right endpoint, as `b`.
        # Because we treat the two one-sided searches as though they were
        # independent, what we keep track of in `work` and what we want to
        # return in `res` look quite different. Combine the results from the
        # two one-sided searches before reporting the results to the user.
        # - "a" refers to the leftward search (the moving end started at `a`)
        # - "b" refers to the rightward search (the moving end started at `b`)
        # - "l" refers to the left end of the bracket (closer to -oo)
        # - "r" refers to the right end of the bracket (closer to +oo)
        xal = res['x'][:n]
        xar = res['x_last'][:n]
        xbl = res['x_last'][n:]
        xbr = res['x'][n:]

        fal = res['f'][:n]
        far = res['f_last'][:n]
        fbl = res['f_last'][n:]
        fbr = res['f'][n:]

        # Initialize the brackets and corresponding function values to return
        # to the user. Brackets may not be valid (e.g. there is no root,
        # there weren't enough iterations, NaN encountered), but we still need
        # to return something. One option would be all NaNs, but what I've
        # chosen here is the left- and right-most points at which the function
        # has been evaluated. This gives the user some information about what
        # interval of the real line has been searched and shows that there is
        # no sign change between the two ends.
        xl = xp.asarray(xal, copy=True)
        fl = xp.asarray(fal, copy=True)
        xr = xp.asarray(xbr, copy=True)
        fr = xp.asarray(fbr, copy=True)

        # `status` indicates whether the bracket is valid or not. If so,
        # we want to adjust the bracket we return to be the narrowest possible
        # given the points at which we evaluated the function.
        # For example if bracket "a" is valid and smaller than bracket "b" OR
        # if bracket "a" is valid and bracket "b" is not valid, we want to
        # return bracket "a" (and vice versa).
        sa = res['status'][:n]
        sb = res['status'][n:]

        da = xar - xal
        db = xbr - xbl

        i1 = ((da <= db) & (sa == 0)) | ((sa == 0) & (sb != 0))
        i2 = ((db <= da) & (sb == 0)) | ((sb == 0) & (sa != 0))

        xr[i1] = xar[i1]
        fr[i1] = far[i1]
        xl[i2] = xbl[i2]
        fl[i2] = fbl[i2]

        # Finish assembling the result object
        res['xl'] = xl
        res['xr'] = xr
        res['fl'] = fl
        res['fr'] = fr

        res['nit'] = xp.maximum(res['nit'][:n], res['nit'][n:])
        res['nfev'] = res['nfev'][:n] + res['nfev'][n:]
        # If the status on one side is zero, the status is zero. In any case,
        # report the status from one side only.
        res['status'] = xp.where(sa == 0, sa, sb)
        res['success'] = (res['status'] == 0)

        del res['x']
        del res['f']
        del res['x_last']
        del res['f_last']

        return shape[:-1]

    return eim._loop(work, callback, shape, maxiter, func, args, dtype,
                     pre_func_eval, post_func_eval, check_termination,
                     post_termination_check, customize_result, res_work_pairs,
                     xp)


def _bracket_minimum_iv(func, xm0, xl0, xr0, xmin, xmax, factor, args, maxiter):

    if not callable(func):
        raise ValueError('`func` must be callable.')

    if not np.iterable(args):
        args = (args,)

    xp = array_namespace(xm0, xl0, xr0, xmin, xmax, factor, *args)

    xmin = -xp.inf if xmin is None else xmin
    xmax = xp.inf if xmax is None else xmax

    # If xl0 (xr0) is not supplied, fill with a dummy value for the sake
    # of broadcasting. We need to wait until xmin (xmax) has been validated
    # to compute the default values.
    xl0_not_supplied = False
    if xl0 is None:
        xl0 = xp.nan
        xl0_not_supplied = True

    xr0_not_supplied = False
    if xr0 is None:
        xr0 = xp.nan
        xr0_not_supplied = True

    factor = 2.0 if factor is None else factor

    xm0, xl0, xr0, xmin, xmax, factor = xp_promote(
        xm0, xl0, xr0, xmin, xmax, factor, broadcast=True, force_floating=True, xp=xp)

    if not xp.isdtype(xm0.dtype, ('integral', 'real floating')):
        raise ValueError('`xm0` must be numeric and real.')

    if (not xp.isdtype(xl0.dtype, "numeric")
        or xp.isdtype(xl0.dtype, "complex floating")):
        raise ValueError('`xl0` must be numeric and real.')

    if (not xp.isdtype(xr0.dtype, "numeric")
        or xp.isdtype(xr0.dtype, "complex floating")):
        raise ValueError('`xr0` must be numeric and real.')

    if (not xp.isdtype(xmin.dtype, "numeric")
        or xp.isdtype(xmin.dtype, "complex floating")):
        raise ValueError('`xmin` must be numeric and real.')

    if (not xp.isdtype(xmax.dtype, "numeric")
        or xp.isdtype(xmax.dtype, "complex floating")):
        raise ValueError('`xmax` must be numeric and real.')

    if (not xp.isdtype(factor.dtype, "numeric")
        or xp.isdtype(factor.dtype, "complex floating")):
        raise ValueError('`factor` must be numeric and real.')
    if not xp.all(factor > 1):
        raise ValueError('All elements of `factor` must be greater than 1.')

    # Calculate default values of xl0 and/or xr0 if they have not been supplied
    # by the user. We need to be careful to ensure xl0 and xr0 are not outside
    # of (xmin, xmax).
    if xl0_not_supplied:
        xl0 = xm0 - xp.minimum((xm0 - xmin)/16, 0.5)
        xl0 = xp.astype(xl0, xm0.dtype, copy=False)
    if xr0_not_supplied:
        xr0 = xm0 + xp.minimum((xmax - xm0)/16, 0.5)
        xr0 = xp.astype(xr0, xm0.dtype, copy=False)

    maxiter = xp.asarray(maxiter)
    message = '`maxiter` must be a non-negative integer.'
    if (not xp.isdtype(maxiter.dtype, "numeric") or maxiter.shape != tuple()
            or xp.isdtype(maxiter.dtype, "complex floating")):
        raise ValueError(message)
    maxiter_int = int(maxiter[()])
    if not maxiter == maxiter_int or maxiter < 0:
        raise ValueError(message)

    return func, xm0, xl0, xr0, xmin, xmax, factor, args, maxiter, xp


def _bracket_minimum(func, xm0, *, xl0=None, xr0=None, xmin=None, xmax=None,
                     factor=None, args=(), maxiter=1000):
    """Bracket the minimum of a unimodal scalar function of one variable

    This function works elementwise when `xm0`, `xl0`, `xr0`, `xmin`, `xmax`,
    and the elements of `args` are broadcastable arrays.

    Parameters
    ----------
    func : callable
        The function for which the minimum is to be bracketed.
        The signature must be::

            func(x: ndarray, *args) -> ndarray

        where each element of ``x`` is a finite real and ``args`` is a tuple,
        which may contain an arbitrary number of arrays that are broadcastable
        with ``x``. `func` must be an elementwise function: each element
        ``func(x)[i]`` must equal ``func(x[i])`` for all indices `i`.
    xm0: float array_like
        Starting guess for middle point of bracket.
    xl0, xr0: float array_like, optional
        Starting guesses for left and right endpoints of the bracket. Must be
        broadcastable with one another and with `xm0`.
    xmin, xmax : float array_like, optional
        Minimum and maximum allowable endpoints of the bracket, inclusive. Must
        be broadcastable with `xl0`, `xm0`, and `xr0`.
    factor : float array_like, optional
        Controls expansion of bracket endpoint in downhill direction. Works
        differently in the cases where a limit is set in the downhill direction
        with `xmax` or `xmin`. See Notes.
    args : tuple, optional
        Additional positional arguments to be passed to `func`.  Must be arrays
        broadcastable with `xl0`, `xm0`, `xr0`, `xmin`, and `xmax`. If the
        callable to be bracketed requires arguments that are not broadcastable
        with these arrays, wrap that callable with `func` such that `func`
        accepts only ``x`` and broadcastable arrays.
    maxiter : int, optional
        The maximum number of iterations of the algorithm to perform. The number
        of function evaluations is three greater than the number of iterations.

    Returns
    -------
    res : _RichResult
        An instance of `scipy._lib._util._RichResult` with the following
        attributes. The descriptions are written as though the values will be
        scalars; however, if `func` returns an array, the outputs will be
        arrays of the same shape.

        xl, xm, xr : float
            The left, middle, and right points of the bracket, if the algorithm
            terminated successfully.
        fl, fm, fr : float
            The function value at the left, middle, and right points of the bracket.
        nfev : int
            The number of function evaluations required to find the bracket.
        nit : int
            The number of iterations of the algorithm that were performed.
        status : int
            An integer representing the exit status of the algorithm.

            - ``0`` : The algorithm produced a valid bracket.
            - ``-1`` : The bracket expanded to the allowable limits. Assuming
                       unimodality, this implies the endpoint at the limit is a
                       minimizer.
            - ``-2`` : The maximum number of iterations was reached.
            - ``-3`` : A non-finite value was encountered.
            - ``-4`` : ``None`` shall pass.
            - ``-5`` : The initial bracket does not satisfy
                       `xmin <= xl0 < xm0 < xr0 <= xmax`.

        success : bool
            ``True`` when the algorithm terminated successfully (status ``0``).

    Notes
    -----
    Similar to `scipy.optimize.bracket`, this function seeks to find real
    points ``xl < xm < xr`` such that ``f(xl) >= f(xm)`` and ``f(xr) >= f(xm)``,
    where at least one of the inequalities is strict. Unlike `scipy.optimize.bracket`,
    this function can operate in a vectorized manner on array input, so long as
    the input arrays are broadcastable with each other. Also unlike
    `scipy.optimize.bracket`, users may specify minimum and maximum endpoints
    for the desired bracket.

    Given an initial trio of points ``xl = xl0``, ``xm = xm0``, ``xr = xr0``,
    the algorithm checks if these points already give a valid bracket. If not,
    a new endpoint, ``w`` is chosen in the "downhill" direction, ``xm`` becomes the new
    opposite endpoint, and either `xl` or `xr` becomes the new middle point,
    depending on which direction is downhill. The algorithm repeats from here.

    The new endpoint `w` is chosen differently depending on whether or not a
    boundary `xmin` or `xmax` has been set in the downhill direction. Without
    loss of generality, suppose the downhill direction is to the right, so that
    ``f(xl) > f(xm) > f(xr)``. If there is no boundary to the right, then `w`
    is chosen to be ``xr + factor * (xr - xm)`` where `factor` is controlled by
    the user (defaults to 2.0) so that step sizes increase in geometric proportion.
    If there is a boundary, `xmax` in this case, then `w` is chosen to be
    ``xmax - (xmax - xr)/factor``, with steps slowing to a stop at
    `xmax`. This cautious approach ensures that a minimum near but distinct from
    the boundary isn't missed while also detecting whether or not the `xmax` is
    a minimizer when `xmax` is reached after a finite number of steps.
    """  # noqa: E501
    callback = None  # works; I just don't want to test it

    temp = _bracket_minimum_iv(func, xm0, xl0, xr0, xmin, xmax, factor, args, maxiter)
    func, xm0, xl0, xr0, xmin, xmax, factor, args, maxiter, xp = temp

    xs = (xl0, xm0, xr0)
    temp = eim._initialize(func, xs, args)
    func, xs, fs, args, shape, dtype, xp = temp

    xl0, xm0, xr0 = xs
    fl0, fm0, fr0 = fs
    xmin = xp.astype(xp.broadcast_to(xmin, shape), dtype, copy=False)
    xmin = xp_ravel(xmin, xp=xp)
    xmax = xp.astype(xp.broadcast_to(xmax, shape), dtype, copy=False)
    xmax = xp_ravel(xmax, xp=xp)
    invalid_bracket = ~((xmin <= xl0) & (xl0 < xm0) & (xm0 < xr0) & (xr0 <= xmax))
    # We will modify factor later on so make a copy. np.broadcast_to returns
    # a read-only view.
    factor = xp.astype(xp.broadcast_to(factor, shape), dtype, copy=True)
    factor = xp_ravel(factor)

    # To simplify the logic, swap xl and xr if f(xl) < f(xr). We should always be
    # marching downhill in the direction from xl to xr.
    comp = fl0 < fr0
    xl0[comp], xr0[comp] = xr0[comp], xl0[comp]
    fl0[comp], fr0[comp] = fr0[comp], fl0[comp]
    # We only need the boundary in the direction we're traveling.
    limit = xp.where(comp, xmin, xmax)

    unlimited = xp.isinf(limit)
    limited = ~unlimited
    step = xp.empty_like(xl0)

    step[unlimited] = (xr0[unlimited] - xm0[unlimited])
    step[limited] = (limit[limited] - xr0[limited])

    # Step size is divided by factor for case where there is a limit.
    factor[limited] = 1 / factor[limited]

    status = xp.full_like(xl0, eim._EINPROGRESS, dtype=xp.int32)
    status[invalid_bracket] = eim._EINPUTERR
    nit, nfev = 0, 3

    work = _RichResult(xl=xl0, xm=xm0, xr=xr0, xr0=xr0, fl=fl0, fm=fm0, fr=fr0,
                       step=step, limit=limit, limited=limited, factor=factor, nit=nit,
                       nfev=nfev, status=status, args=args)

    res_work_pairs = [('status', 'status'), ('xl', 'xl'), ('xm', 'xm'), ('xr', 'xr'),
                      ('nit', 'nit'), ('nfev', 'nfev'), ('fl', 'fl'), ('fm', 'fm'),
                      ('fr', 'fr')]

    def pre_func_eval(work):
        work.step *= work.factor
        x = xp.empty_like(work.xr)
        x[~work.limited] = work.xr0[~work.limited] + work.step[~work.limited]
        x[work.limited] = work.limit[work.limited] - work.step[work.limited]
        # Since the new bracket endpoint is calculated from an offset with the
        # limit, it may be the case that the new endpoint equals the old endpoint,
        # when the old endpoint is sufficiently close to the limit. We use the
        # limit itself as the new endpoint in these cases.
        x[work.limited] = xp.where(
            x[work.limited] == work.xr[work.limited],
            work.limit[work.limited],
            x[work.limited],
        )
        return x

    def post_func_eval(x, f, work):
        work.xl, work.xm, work.xr = work.xm, work.xr, x
        work.fl, work.fm, work.fr = work.fm, work.fr, f

    def check_termination(work):
        # Condition 0: Initial bracket is invalid.
        stop = (work.status == eim._EINPUTERR)

        # Condition 1: A valid bracket has been found.
        i = (
            (work.fl >= work.fm) & (work.fr > work.fm)
            | (work.fl > work.fm) & (work.fr >= work.fm)
        ) & ~stop
        work.status[i] = eim._ECONVERGED
        stop[i] = True

        # Condition 2: Moving end of bracket reaches limit.
        i = (work.xr == work.limit) & ~stop
        work.status[i] = _ELIMITS
        stop[i] = True

        # Condition 3: non-finite value encountered
        i = ~(xp.isfinite(work.xr) & xp.isfinite(work.fr)) & ~stop
        work.status[i] = eim._EVALUEERR
        stop[i] = True

        return stop

    def post_termination_check(work):
        pass

    def customize_result(res, shape):
        # Reorder entries of xl and xr if they were swapped due to f(xl0) < f(xr0).
        comp = res['xl'] > res['xr']
        res['xl'][comp], res['xr'][comp] = res['xr'][comp], res['xl'][comp]
        res['fl'][comp], res['fr'][comp] = res['fr'][comp], res['fl'][comp]
        return shape

    return eim._loop(work, callback, shape,
                     maxiter, func, args, dtype,
                     pre_func_eval, post_func_eval,
                     check_termination, post_termination_check,
                     customize_result, res_work_pairs, xp)
