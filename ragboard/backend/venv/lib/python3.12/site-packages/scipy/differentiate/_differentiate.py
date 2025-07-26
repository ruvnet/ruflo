# mypy: disable-error-code="attr-defined"
import warnings
import numpy as np
import scipy._lib._elementwise_iterative_method as eim
from scipy._lib._util import _RichResult
from scipy._lib._array_api import array_namespace, xp_copy, xp_promote
import scipy._lib.array_api_extra as xpx

_EERRORINCREASE = -1  # used in derivative

def _derivative_iv(f, x, args, tolerances, maxiter, order, initial_step,
                   step_factor, step_direction, preserve_shape, callback):
    # Input validation for `derivative`
    xp = array_namespace(x)

    if not callable(f):
        raise ValueError('`f` must be callable.')

    if not np.iterable(args):
        args = (args,)

    tolerances = {} if tolerances is None else tolerances
    atol = tolerances.get('atol', None)
    rtol = tolerances.get('rtol', None)

    # tolerances are floats, not arrays; OK to use NumPy
    message = 'Tolerances and step parameters must be non-negative scalars.'
    tols = np.asarray([atol if atol is not None else 1,
                       rtol if rtol is not None else 1,
                       step_factor])
    if (not np.issubdtype(tols.dtype, np.number) or np.any(tols < 0)
            or np.any(np.isnan(tols)) or tols.shape != (3,)):
        raise ValueError(message)
    step_factor = float(tols[2])

    maxiter_int = int(maxiter)
    if maxiter != maxiter_int or maxiter <= 0:
        raise ValueError('`maxiter` must be a positive integer.')

    order_int = int(order)
    if order_int != order or order <= 0:
        raise ValueError('`order` must be a positive integer.')

    step_direction = xp.asarray(step_direction)
    initial_step = xp.asarray(initial_step)
    temp = xp.broadcast_arrays(x, step_direction, initial_step)
    x, step_direction, initial_step = temp

    message = '`preserve_shape` must be True or False.'
    if preserve_shape not in {True, False}:
        raise ValueError(message)

    if callback is not None and not callable(callback):
        raise ValueError('`callback` must be callable.')

    return (f, x, args, atol, rtol, maxiter_int, order_int, initial_step,
            step_factor, step_direction, preserve_shape, callback)


def derivative(f, x, *, args=(), tolerances=None, maxiter=10,
               order=8, initial_step=0.5, step_factor=2.0,
               step_direction=0, preserve_shape=False, callback=None):
    """Evaluate the derivative of a elementwise, real scalar function numerically.

    For each element of the output of `f`, `derivative` approximates the first
    derivative of `f` at the corresponding element of `x` using finite difference
    differentiation.

    This function works elementwise when `x`, `step_direction`, and `args` contain
    (broadcastable) arrays.

    Parameters
    ----------
    f : callable
        The function whose derivative is desired. The signature must be::

            f(xi: ndarray, *argsi) -> ndarray

        where each element of ``xi`` is a finite real number and ``argsi`` is a tuple,
        which may contain an arbitrary number of arrays that are broadcastable with
        ``xi``. `f` must be an elementwise function: each scalar element ``f(xi)[j]``
        must equal ``f(xi[j])`` for valid indices ``j``. It must not mutate the array
        ``xi`` or the arrays in ``argsi``.
    x : float array_like
        Abscissae at which to evaluate the derivative. Must be broadcastable with
        `args` and `step_direction`.
    args : tuple of array_like, optional
        Additional positional array arguments to be passed to `f`. Arrays
        must be broadcastable with one another and the arrays of `init`.
        If the callable for which the root is desired requires arguments that are
        not broadcastable with `x`, wrap that callable with `f` such that `f`
        accepts only `x` and broadcastable ``*args``.
    tolerances : dictionary of floats, optional
        Absolute and relative tolerances. Valid keys of the dictionary are:

        - ``atol`` - absolute tolerance on the derivative
        - ``rtol`` - relative tolerance on the derivative

        Iteration will stop when ``res.error < atol + rtol * abs(res.df)``. The default
        `atol` is the smallest normal number of the appropriate dtype, and
        the default `rtol` is the square root of the precision of the
        appropriate dtype.
    order : int, default: 8
        The (positive integer) order of the finite difference formula to be
        used. Odd integers will be rounded up to the next even integer.
    initial_step : float array_like, default: 0.5
        The (absolute) initial step size for the finite difference derivative
        approximation.
    step_factor : float, default: 2.0
        The factor by which the step size is *reduced* in each iteration; i.e.
        the step size in iteration 1 is ``initial_step/step_factor``. If
        ``step_factor < 1``, subsequent steps will be greater than the initial
        step; this may be useful if steps smaller than some threshold are
        undesirable (e.g. due to subtractive cancellation error).
    maxiter : int, default: 10
        The maximum number of iterations of the algorithm to perform. See
        Notes.
    step_direction : integer array_like
        An array representing the direction of the finite difference steps (for
        use when `x` lies near to the boundary of the domain of the function.)
        Must be broadcastable with `x` and all `args`.
        Where 0 (default), central differences are used; where negative (e.g.
        -1), steps are non-positive; and where positive (e.g. 1), all steps are
        non-negative.
    preserve_shape : bool, default: False
        In the following, "arguments of `f`" refers to the array ``xi`` and
        any arrays within ``argsi``. Let ``shape`` be the broadcasted shape
        of `x` and all elements of `args` (which is conceptually
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
        similar to that returned by `derivative` (but containing the current
        iterate's values of all variables). If `callback` raises a
        ``StopIteration``, the algorithm will terminate immediately and
        `derivative` will return a result. `callback` must not mutate
        `res` or its attributes.

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
            - ``-1`` : The error estimate increased, so iteration was terminated.
            - ``-2`` : The maximum number of iterations was reached.
            - ``-3`` : A non-finite value was encountered.
            - ``-4`` : Iteration was terminated by `callback`.
            - ``1`` : The algorithm is proceeding normally (in `callback` only).

        df : float array
            The derivative of `f` at `x`, if the algorithm terminated
            successfully.
        error : float array
            An estimate of the error: the magnitude of the difference between
            the current estimate of the derivative and the estimate in the
            previous iteration.
        nit : int array
            The number of iterations of the algorithm that were performed.
        nfev : int array
            The number of points at which `f` was evaluated.
        x : float array
            The value at which the derivative of `f` was evaluated
            (after broadcasting with `args` and `step_direction`).

    See Also
    --------
    jacobian, hessian

    Notes
    -----
    The implementation was inspired by jacobi [1]_, numdifftools [2]_, and
    DERIVEST [3]_, but the implementation follows the theory of Taylor series
    more straightforwardly (and arguably naively so).
    In the first iteration, the derivative is estimated using a finite
    difference formula of order `order` with maximum step size `initial_step`.
    Each subsequent iteration, the maximum step size is reduced by
    `step_factor`, and the derivative is estimated again until a termination
    condition is reached. The error estimate is the magnitude of the difference
    between the current derivative approximation and that of the previous
    iteration.

    The stencils of the finite difference formulae are designed such that
    abscissae are "nested": after `f` is evaluated at ``order + 1``
    points in the first iteration, `f` is evaluated at only two new points
    in each subsequent iteration; ``order - 1`` previously evaluated function
    values required by the finite difference formula are reused, and two
    function values (evaluations at the points furthest from `x`) are unused.

    Step sizes are absolute. When the step size is small relative to the
    magnitude of `x`, precision is lost; for example, if `x` is ``1e20``, the
    default initial step size of ``0.5`` cannot be resolved. Accordingly,
    consider using larger initial step sizes for large magnitudes of `x`.

    The default tolerances are challenging to satisfy at points where the
    true derivative is exactly zero. If the derivative may be exactly zero,
    consider specifying an absolute tolerance (e.g. ``atol=1e-12``) to
    improve convergence.

    References
    ----------
    .. [1] Hans Dembinski (@HDembinski). jacobi.
           https://github.com/HDembinski/jacobi
    .. [2] Per A. Brodtkorb and John D'Errico. numdifftools.
           https://numdifftools.readthedocs.io/en/latest/
    .. [3] John D'Errico. DERIVEST: Adaptive Robust Numerical Differentiation.
           https://www.mathworks.com/matlabcentral/fileexchange/13490-adaptive-robust-numerical-differentiation
    .. [4] Numerical Differentition. Wikipedia.
           https://en.wikipedia.org/wiki/Numerical_differentiation

    Examples
    --------
    Evaluate the derivative of ``np.exp`` at several points ``x``.

    >>> import numpy as np
    >>> from scipy.differentiate import derivative
    >>> f = np.exp
    >>> df = np.exp  # true derivative
    >>> x = np.linspace(1, 2, 5)
    >>> res = derivative(f, x)
    >>> res.df  # approximation of the derivative
    array([2.71828183, 3.49034296, 4.48168907, 5.75460268, 7.3890561 ])
    >>> res.error  # estimate of the error
    array([7.13740178e-12, 9.16600129e-12, 1.17594823e-11, 1.51061386e-11,
           1.94262384e-11])
    >>> abs(res.df - df(x))  # true error
    array([2.53130850e-14, 3.55271368e-14, 5.77315973e-14, 5.59552404e-14,
           6.92779167e-14])

    Show the convergence of the approximation as the step size is reduced.
    Each iteration, the step size is reduced by `step_factor`, so for
    sufficiently small initial step, each iteration reduces the error by a
    factor of ``1/step_factor**order`` until finite precision arithmetic
    inhibits further improvement.

    >>> import matplotlib.pyplot as plt
    >>> iter = list(range(1, 12))  # maximum iterations
    >>> hfac = 2  # step size reduction per iteration
    >>> hdir = [-1, 0, 1]  # compare left-, central-, and right- steps
    >>> order = 4  # order of differentiation formula
    >>> x = 1
    >>> ref = df(x)
    >>> errors = []  # true error
    >>> for i in iter:
    ...     res = derivative(f, x, maxiter=i, step_factor=hfac,
    ...                      step_direction=hdir, order=order,
    ...                      # prevent early termination
    ...                      tolerances=dict(atol=0, rtol=0))
    ...     errors.append(abs(res.df - ref))
    >>> errors = np.array(errors)
    >>> plt.semilogy(iter, errors[:, 0], label='left differences')
    >>> plt.semilogy(iter, errors[:, 1], label='central differences')
    >>> plt.semilogy(iter, errors[:, 2], label='right differences')
    >>> plt.xlabel('iteration')
    >>> plt.ylabel('error')
    >>> plt.legend()
    >>> plt.show()
    >>> (errors[1, 1] / errors[0, 1], 1 / hfac**order)
    (0.06215223140159822, 0.0625)

    The implementation is vectorized over `x`, `step_direction`, and `args`.
    The function is evaluated once before the first iteration to perform input
    validation and standardization, and once per iteration thereafter.

    >>> def f(x, p):
    ...     f.nit += 1
    ...     return x**p
    >>> f.nit = 0
    >>> def df(x, p):
    ...     return p*x**(p-1)
    >>> x = np.arange(1, 5)
    >>> p = np.arange(1, 6).reshape((-1, 1))
    >>> hdir = np.arange(-1, 2).reshape((-1, 1, 1))
    >>> res = derivative(f, x, args=(p,), step_direction=hdir, maxiter=1)
    >>> np.allclose(res.df, df(x, p))
    True
    >>> res.df.shape
    (3, 5, 4)
    >>> f.nit
    2

    By default, `preserve_shape` is False, and therefore the callable
    `f` may be called with arrays of any broadcastable shapes.
    For example:

    >>> shapes = []
    >>> def f(x, c):
    ...    shape = np.broadcast_shapes(x.shape, c.shape)
    ...    shapes.append(shape)
    ...    return np.sin(c*x)
    >>>
    >>> c = [1, 5, 10, 20]
    >>> res = derivative(f, 0, args=(c,))
    >>> shapes
    [(4,), (4, 8), (4, 2), (3, 2), (2, 2), (1, 2)]

    To understand where these shapes are coming from - and to better
    understand how `derivative` computes accurate results - note that
    higher values of ``c`` correspond with higher frequency sinusoids.
    The higher frequency sinusoids make the function's derivative change
    faster, so more function evaluations are required to achieve the target
    accuracy:

    >>> res.nfev
    array([11, 13, 15, 17], dtype=int32)

    The initial ``shape``, ``(4,)``, corresponds with evaluating the
    function at a single abscissa and all four frequencies; this is used
    for input validation and to determine the size and dtype of the arrays
    that store results. The next shape corresponds with evaluating the
    function at an initial grid of abscissae and all four frequencies.
    Successive calls to the function evaluate the function at two more
    abscissae, increasing the effective order of the approximation by two.
    However, in later function evaluations, the function is evaluated at
    fewer frequencies because the corresponding derivative has already
    converged to the required tolerance. This saves function evaluations to
    improve performance, but it requires the function to accept arguments of
    any shape.

    "Vector-valued" functions are unlikely to satisfy this requirement.
    For example, consider

    >>> def f(x):
    ...    return [x, np.sin(3*x), x+np.sin(10*x), np.sin(20*x)*(x-1)**2]

    This integrand is not compatible with `derivative` as written; for instance,
    the shape of the output will not be the same as the shape of ``x``. Such a
    function *could* be converted to a compatible form with the introduction of
    additional parameters, but this would be inconvenient. In such cases,
    a simpler solution would be to use `preserve_shape`.

    >>> shapes = []
    >>> def f(x):
    ...     shapes.append(x.shape)
    ...     x0, x1, x2, x3 = x
    ...     return [x0, np.sin(3*x1), x2+np.sin(10*x2), np.sin(20*x3)*(x3-1)**2]
    >>>
    >>> x = np.zeros(4)
    >>> res = derivative(f, x, preserve_shape=True)
    >>> shapes
    [(4,), (4, 8), (4, 2), (4, 2), (4, 2), (4, 2)]

    Here, the shape of ``x`` is ``(4,)``. With ``preserve_shape=True``, the
    function may be called with argument ``x`` of shape ``(4,)`` or ``(4, n)``,
    and this is what we observe.

    """
    # TODO (followup):
    #  - investigate behavior at saddle points
    #  - multivariate functions?
    #  - relative steps?
    #  - show example of `np.vectorize`

    res = _derivative_iv(f, x, args, tolerances, maxiter, order, initial_step,
                            step_factor, step_direction, preserve_shape, callback)
    (func, x, args, atol, rtol, maxiter, order,
     h0, fac, hdir, preserve_shape, callback) = res

    # Initialization
    # Since f(x) (no step) is not needed for central differences, it may be
    # possible to eliminate this function evaluation. However, it's useful for
    # input validation and standardization, and everything else is designed to
    # reduce function calls, so let's keep it simple.
    temp = eim._initialize(func, (x,), args, preserve_shape=preserve_shape)
    func, xs, fs, args, shape, dtype, xp = temp

    finfo = xp.finfo(dtype)
    atol = finfo.smallest_normal if atol is None else atol
    rtol = finfo.eps**0.5 if rtol is None else rtol  # keep same as `hessian`

    x, f = xs[0], fs[0]
    df = xp.full_like(f, xp.nan)

    # Ideally we'd broadcast the shape of `hdir` in `_elementwise_algo_init`, but
    # it's simpler to do it here than to generalize `_elementwise_algo_init` further.
    # `hdir` and `x` are already broadcasted in `_derivative_iv`, so we know
    # that `hdir` can be broadcasted to the final shape. Same with `h0`.
    hdir = xp.broadcast_to(hdir, shape)
    hdir = xp.reshape(hdir, (-1,))
    hdir = xp.astype(xp.sign(hdir), dtype)
    h0 = xp.broadcast_to(h0, shape)
    h0 = xp.reshape(h0, (-1,))
    h0 = xp.astype(h0, dtype)
    h0 = xpx.at(h0)[h0 <= 0].set(xp.nan)

    status = xp.full_like(x, eim._EINPROGRESS, dtype=xp.int32)  # in progress
    nit, nfev = 0, 1  # one function evaluations performed above
    # Boolean indices of left, central, right, and (all) one-sided steps
    il = hdir < 0
    ic = hdir == 0
    ir = hdir > 0
    io = il | ir

    # Most of these attributes are reasonably obvious, but:
    # - `fs` holds all the function values of all active `x`. The zeroth
    #   axis corresponds with active points `x`, the first axis corresponds
    #   with the different steps (in the order described in
    #   `_derivative_weights`).
    # - `terms` (which could probably use a better name) is half the `order`,
    #   which is always even.
    work = _RichResult(x=x, df=df, fs=f[:, xp.newaxis], error=xp.nan, h=h0,
                       df_last=xp.nan, error_last=xp.nan, fac=fac,
                       atol=atol, rtol=rtol, nit=nit, nfev=nfev,
                       status=status, dtype=dtype, terms=(order+1)//2,
                       hdir=hdir, il=il, ic=ic, ir=ir, io=io,
                       # Store the weights in an object so they can't get compressed
                       # Using RichResult to allow dot notation, but a dict would work
                       diff_state=_RichResult(central=[], right=[], fac=None))

    # This is the correspondence between terms in the `work` object and the
    # final result. In this case, the mapping is trivial. Note that `success`
    # is prepended automatically.
    res_work_pairs = [('status', 'status'), ('df', 'df'), ('error', 'error'),
                      ('nit', 'nit'), ('nfev', 'nfev'), ('x', 'x')]

    def pre_func_eval(work):
        """Determine the abscissae at which the function needs to be evaluated.

        See `_derivative_weights` for a description of the stencil (pattern
        of the abscissae).

        In the first iteration, there is only one stored function value in
        `work.fs`, `f(x)`, so we need to evaluate at `order` new points. In
        subsequent iterations, we evaluate at two new points. Note that
        `work.x` is always flattened into a 1D array after broadcasting with
        all `args`, so we add a new axis at the end and evaluate all point
        in one call to the function.

        For improvement:
        - Consider measuring the step size actually taken, since ``(x + h) - x``
          is not identically equal to `h` with floating point arithmetic.
        - Adjust the step size automatically if `x` is too big to resolve the
          step.
        - We could probably save some work if there are no central difference
          steps or no one-sided steps.
        """
        n = work.terms  # half the order
        h = work.h[:, xp.newaxis]  # step size
        c = work.fac  # step reduction factor
        d = c**0.5  # square root of step reduction factor (one-sided stencil)
        # Note - no need to be careful about dtypes until we allocate `x_eval`

        if work.nit == 0:
            hc = h / c**xp.arange(n, dtype=work.dtype)
            hc = xp.concat((-xp.flip(hc, axis=-1), hc), axis=-1)
        else:
            hc = xp.concat((-h, h), axis=-1) / c**(n-1)

        if work.nit == 0:
            hr = h / d**xp.arange(2*n, dtype=work.dtype)
        else:
            hr = xp.concat((h, h/d), axis=-1) / c**(n-1)

        n_new = 2*n if work.nit == 0 else 2  # number of new abscissae
        x_eval = xp.zeros((work.hdir.shape[0], n_new), dtype=work.dtype)
        il, ic, ir = work.il, work.ic, work.ir
        x_eval = xpx.at(x_eval)[ir].set(work.x[ir][:, xp.newaxis] + hr[ir])
        x_eval = xpx.at(x_eval)[ic].set(work.x[ic][:, xp.newaxis] + hc[ic])
        x_eval = xpx.at(x_eval)[il].set(work.x[il][:, xp.newaxis] - hr[il])
        return x_eval

    def post_func_eval(x, f, work):
        """ Estimate the derivative and error from the function evaluations

        As in `pre_func_eval`: in the first iteration, there is only one stored
        function value in `work.fs`, `f(x)`, so we need to add the `order` new
        points. In subsequent iterations, we add two new points. The tricky
        part is getting the order to match that of the weights, which is
        described in `_derivative_weights`.

        For improvement:
        - Change the order of the weights (and steps in `pre_func_eval`) to
          simplify `work_fc` concatenation and eliminate `fc` concatenation.
        - It would be simple to do one-step Richardson extrapolation with `df`
          and `df_last` to increase the order of the estimate and/or improve
          the error estimate.
        - Process the function evaluations in a more numerically favorable
          way. For instance, combining the pairs of central difference evals
          into a second-order approximation and using Richardson extrapolation
          to produce a higher order approximation seemed to retain accuracy up
          to very high order.
        - Alternatively, we could use `polyfit` like Jacobi. An advantage of
          fitting polynomial to more points than necessary is improved noise
          tolerance.
        """
        n = work.terms
        n_new = n if work.nit == 0 else 1
        il, ic, io = work.il, work.ic, work.io

        # Central difference
        # `work_fc` is *all* the points at which the function has been evaluated
        # `fc` is the points we're using *this iteration* to produce the estimate
        work_fc = (f[ic][:, :n_new], work.fs[ic], f[ic][:, -n_new:])
        work_fc = xp.concat(work_fc, axis=-1)
        if work.nit == 0:
            fc = work_fc
        else:
            fc = (work_fc[:, :n], work_fc[:, n:n+1], work_fc[:, -n:])
            fc = xp.concat(fc, axis=-1)

        # One-sided difference
        work_fo = xp.concat((work.fs[io], f[io]), axis=-1)
        if work.nit == 0:
            fo = work_fo
        else:
            fo = xp.concat((work_fo[:, 0:1], work_fo[:, -2*n:]), axis=-1)

        work.fs = xp.zeros((ic.shape[0], work.fs.shape[-1] + 2*n_new), dtype=work.dtype)
        work.fs = xpx.at(work.fs)[ic].set(work_fc)
        work.fs = xpx.at(work.fs)[io].set(work_fo)

        wc, wo = _derivative_weights(work, n, xp)
        work.df_last = xp.asarray(work.df, copy=True)
        work.df = xpx.at(work.df)[ic].set(fc @ wc / work.h[ic])
        work.df = xpx.at(work.df)[io].set(fo @ wo / work.h[io])
        work.df = xpx.at(work.df)[il].multiply(-1)

        work.h /= work.fac
        work.error_last = work.error
        # Simple error estimate - the difference in derivative estimates between
        # this iteration and the last. This is typically conservative because if
        # convergence has begin, the true error is much closer to the difference
        # between the current estimate and the *next* error estimate. However,
        # we could use Richarson extrapolation to produce an error estimate that
        # is one order higher, and take the difference between that and
        # `work.df` (which would just be constant factor that depends on `fac`.)
        work.error = xp.abs(work.df - work.df_last)

    def check_termination(work):
        """Terminate due to convergence, non-finite values, or error increase"""
        stop = xp.astype(xp.zeros_like(work.df), xp.bool)

        i = work.error < work.atol + work.rtol*abs(work.df)
        work.status = xpx.at(work.status)[i].set(eim._ECONVERGED)
        stop = xpx.at(stop)[i].set(True)

        if work.nit > 0:
            i = ~((xp.isfinite(work.x) & xp.isfinite(work.df)) | stop)
            work.df = xpx.at(work.df)[i].set(xp.nan)
            work.status = xpx.at(work.status)[i].set(eim._EVALUEERR)
            stop = xpx.at(stop)[i].set(True)

        # With infinite precision, there is a step size below which
        # all smaller step sizes will reduce the error. But in floating point
        # arithmetic, catastrophic cancellation will begin to cause the error
        # to increase again. This heuristic tries to avoid step sizes that are
        # too small. There may be more theoretically sound approaches for
        # detecting a step size that minimizes the total error, but this
        # heuristic seems simple and effective.
        i = (work.error > work.error_last*10) & ~stop
        work.status = xpx.at(work.status)[i].set(_EERRORINCREASE)
        stop = xpx.at(stop)[i].set(True)

        return stop

    def post_termination_check(work):
        return

    def customize_result(res, shape):
        return shape

    return eim._loop(work, callback, shape, maxiter, func, args, dtype,
                     pre_func_eval, post_func_eval, check_termination,
                     post_termination_check, customize_result, res_work_pairs,
                     xp, preserve_shape)


def _derivative_weights(work, n, xp):
    # This produces the weights of the finite difference formula for a given
    # stencil. In experiments, use of a second-order central difference formula
    # with Richardson extrapolation was more accurate numerically, but it was
    # more complicated, and it would have become even more complicated when
    # adding support for one-sided differences. However, now that all the
    # function evaluation values are stored, they can be processed in whatever
    # way is desired to produce the derivative estimate. We leave alternative
    # approaches to future work. To be more self-contained, here is the theory
    # for deriving the weights below.
    #
    # Recall that the Taylor expansion of a univariate, scalar-values function
    # about a point `x` may be expressed as:
    #      f(x + h)  =     f(x) + f'(x)*h + f''(x)/2!*h**2  + O(h**3)
    # Suppose we evaluate f(x), f(x+h), and f(x-h).  We have:
    #      f(x)      =     f(x)
    #      f(x + h)  =     f(x) + f'(x)*h + f''(x)/2!*h**2  + O(h**3)
    #      f(x - h)  =     f(x) - f'(x)*h + f''(x)/2!*h**2  + O(h**3)
    # We can solve for weights `wi` such that:
    #   w1*f(x)      = w1*(f(x))
    # + w2*f(x + h)  = w2*(f(x) + f'(x)*h + f''(x)/2!*h**2) + O(h**3)
    # + w3*f(x - h)  = w3*(f(x) - f'(x)*h + f''(x)/2!*h**2) + O(h**3)
    #                =     0    + f'(x)*h + 0               + O(h**3)
    # Then
    #     f'(x) ~ (w1*f(x) + w2*f(x+h) + w3*f(x-h))/h
    # is a finite difference derivative approximation with error O(h**2),
    # and so it is said to be a "second-order" approximation. Under certain
    # conditions (e.g. well-behaved function, `h` sufficiently small), the
    # error in the approximation will decrease with h**2; that is, if `h` is
    # reduced by a factor of 2, the error is reduced by a factor of 4.
    #
    # By default, we use eighth-order formulae. Our central-difference formula
    # uses abscissae:
    #   x-h/c**3, x-h/c**2, x-h/c, x-h, x, x+h, x+h/c, x+h/c**2, x+h/c**3
    # where `c` is the step factor. (Typically, the step factor is greater than
    # one, so the outermost points - as written above - are actually closest to
    # `x`.) This "stencil" is chosen so that each iteration, the step can be
    # reduced by the factor `c`, and most of the function evaluations can be
    # reused with the new step size. For example, in the next iteration, we
    # will have:
    #   x-h/c**4, x-h/c**3, x-h/c**2, x-h/c, x, x+h/c, x+h/c**2, x+h/c**3, x+h/c**4
    # We do not reuse `x-h` and `x+h` for the new derivative estimate.
    # While this would increase the order of the formula and thus the
    # theoretical convergence rate, it is also less stable numerically.
    # (As noted above, there are other ways of processing the values that are
    # more stable. Thus, even now we store `f(x-h)` and `f(x+h)` in `work.fs`
    # to simplify future development of this sort of improvement.)
    #
    # The (right) one-sided formula is produced similarly using abscissae
    #   x, x+h, x+h/d, x+h/d**2, ..., x+h/d**6, x+h/d**7, x+h/d**7
    # where `d` is the square root of `c`. (The left one-sided formula simply
    # uses -h.) When the step size is reduced by factor `c = d**2`, we have
    # abscissae:
    #   x, x+h/d**2, x+h/d**3..., x+h/d**8, x+h/d**9, x+h/d**9
    # `d` is chosen as the square root of `c` so that the rate of the step-size
    # reduction is the same per iteration as in the central difference case.
    # Note that because the central difference formulas are inherently of even
    # order, for simplicity, we use only even-order formulas for one-sided
    # differences, too.

    # It's possible for the user to specify `fac` in, say, double precision but
    # `x` and `args` in single precision. `fac` gets converted to single
    # precision, but we should always use double precision for the intermediate
    # calculations here to avoid additional error in the weights.
    fac = float(work.fac)

    # Note that if the user switches back to floating point precision with
    # `x` and `args`, then `fac` will not necessarily equal the (lower
    # precision) cached `_derivative_weights.fac`, and the weights will
    # need to be recalculated. This could be fixed, but it's late, and of
    # low consequence.

    diff_state = work.diff_state
    if fac != diff_state.fac:
        diff_state.central = []
        diff_state.right = []
        diff_state.fac = fac

    if len(diff_state.central) != 2*n + 1:
        # Central difference weights. Consider refactoring this; it could
        # probably be more compact.
        # Note: Using NumPy here is OK; we convert to xp-type at the end
        i = np.arange(-n, n + 1)
        p = np.abs(i) - 1.  # center point has power `p` -1, but sign `s` is 0
        s = np.sign(i)

        h = s / fac ** p
        A = np.vander(h, increasing=True).T
        b = np.zeros(2*n + 1)
        b[1] = 1
        weights = np.linalg.solve(A, b)

        # Enforce identities to improve accuracy
        weights[n] = 0
        for i in range(n):
            weights[-i-1] = -weights[i]

        # Cache the weights. We only need to calculate them once unless
        # the step factor changes.
        diff_state.central = weights

        # One-sided difference weights. The left one-sided weights (with
        # negative steps) are simply the negative of the right one-sided
        # weights, so no need to compute them separately.
        i = np.arange(2*n + 1)
        p = i - 1.
        s = np.sign(i)

        h = s / np.sqrt(fac) ** p
        A = np.vander(h, increasing=True).T
        b = np.zeros(2 * n + 1)
        b[1] = 1
        weights = np.linalg.solve(A, b)

        diff_state.right = weights

    return (xp.asarray(diff_state.central, dtype=work.dtype),
            xp.asarray(diff_state.right, dtype=work.dtype))


def jacobian(f, x, *, tolerances=None, maxiter=10, order=8, initial_step=0.5,
             step_factor=2.0, step_direction=0):
    r"""Evaluate the Jacobian of a function numerically.

    Parameters
    ----------
    f : callable
        The function whose Jacobian is desired. The signature must be::

            f(xi: ndarray) -> ndarray

        where each element of ``xi`` is a finite real. If the function to be
        differentiated accepts additional arguments, wrap it (e.g. using
        `functools.partial` or ``lambda``) and pass the wrapped callable
        into `jacobian`. `f` must not mutate the array ``xi``. See Notes
        regarding vectorization and the dimensionality of the input and output.
    x : float array_like
        Points at which to evaluate the Jacobian. Must have at least one dimension.
        See Notes regarding the dimensionality and vectorization.
    tolerances : dictionary of floats, optional
        Absolute and relative tolerances. Valid keys of the dictionary are:

        - ``atol`` - absolute tolerance on the derivative
        - ``rtol`` - relative tolerance on the derivative

        Iteration will stop when ``res.error < atol + rtol * abs(res.df)``. The default
        `atol` is the smallest normal number of the appropriate dtype, and
        the default `rtol` is the square root of the precision of the
        appropriate dtype.
    maxiter : int, default: 10
        The maximum number of iterations of the algorithm to perform. See
        Notes.
    order : int, default: 8
        The (positive integer) order of the finite difference formula to be
        used. Odd integers will be rounded up to the next even integer.
    initial_step : float array_like, default: 0.5
        The (absolute) initial step size for the finite difference derivative
        approximation. Must be broadcastable with `x` and `step_direction`.
    step_factor : float, default: 2.0
        The factor by which the step size is *reduced* in each iteration; i.e.
        the step size in iteration 1 is ``initial_step/step_factor``. If
        ``step_factor < 1``, subsequent steps will be greater than the initial
        step; this may be useful if steps smaller than some threshold are
        undesirable (e.g. due to subtractive cancellation error).
    step_direction : integer array_like
        An array representing the direction of the finite difference steps (e.g.
        for use when `x` lies near to the boundary of the domain of the function.)
        Must be broadcastable with `x` and `initial_step`.
        Where 0 (default), central differences are used; where negative (e.g.
        -1), steps are non-positive; and where positive (e.g. 1), all steps are
        non-negative.

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
            - ``-1`` : The error estimate increased, so iteration was terminated.
            - ``-2`` : The maximum number of iterations was reached.
            - ``-3`` : A non-finite value was encountered.

        df : float array
            The Jacobian of `f` at `x`, if the algorithm terminated
            successfully.
        error : float array
            An estimate of the error: the magnitude of the difference between
            the current estimate of the Jacobian and the estimate in the
            previous iteration.
        nit : int array
            The number of iterations of the algorithm that were performed.
        nfev : int array
            The number of points at which `f` was evaluated.

        Each element of an attribute is associated with the corresponding
        element of `df`. For instance, element ``i`` of `nfev` is the
        number of points at which `f` was evaluated for the sake of
        computing element ``i`` of `df`.

    See Also
    --------
    derivative, hessian

    Notes
    -----
    Suppose we wish to evaluate the Jacobian of a function
    :math:`f: \mathbf{R}^m \rightarrow \mathbf{R}^n`. Assign to variables
    ``m`` and ``n`` the positive integer values of :math:`m` and :math:`n`,
    respectively, and let ``...`` represent an arbitrary tuple of integers.
    If we wish to evaluate the Jacobian at a single point, then:

    - argument `x` must be an array of shape ``(m,)``
    - argument `f` must be vectorized to accept an array of shape ``(m, ...)``.
      The first axis represents the :math:`m` inputs of :math:`f`; the remainder
      are for evaluating the function at multiple points in a single call.
    - argument `f` must return an array of shape ``(n, ...)``. The first
      axis represents the :math:`n` outputs of :math:`f`; the remainder
      are for the result of evaluating the function at multiple points.
    - attribute ``df`` of the result object will be an array of shape ``(n, m)``,
      the Jacobian.

    This function is also vectorized in the sense that the Jacobian can be
    evaluated at ``k`` points in a single call. In this case, `x` would be an
    array of shape ``(m, k)``, `f` would accept an array of shape
    ``(m, k, ...)`` and return an array of shape ``(n, k, ...)``, and the ``df``
    attribute of the result would have shape ``(n, m, k)``.

    Suppose the desired callable ``f_not_vectorized`` is not vectorized; it can
    only accept an array of shape ``(m,)``. A simple solution to satisfy the required
    interface is to wrap ``f_not_vectorized`` as follows::

        def f(x):
            return np.apply_along_axis(f_not_vectorized, axis=0, arr=x)

    Alternatively, suppose the desired callable ``f_vec_q`` is vectorized, but
    only for 2-D arrays of shape ``(m, q)``. To satisfy the required interface,
    consider::

        def f(x):
            m, batch = x.shape[0], x.shape[1:]  # x.shape is (m, ...)
            x = np.reshape(x, (m, -1))  # `-1` is short for q = prod(batch)
            res = f_vec_q(x)  # pass shape (m, q) to function
            n = res.shape[0]
            return np.reshape(res, (n,) + batch)  # return shape (n, ...)

    Then pass the wrapped callable ``f`` as the first argument of `jacobian`.

    References
    ----------
    .. [1] Jacobian matrix and determinant, *Wikipedia*,
           https://en.wikipedia.org/wiki/Jacobian_matrix_and_determinant

    Examples
    --------
    The Rosenbrock function maps from :math:`\mathbf{R}^m \rightarrow \mathbf{R}`;
    the SciPy implementation `scipy.optimize.rosen` is vectorized to accept an
    array of shape ``(m, p)`` and return an array of shape ``p``. Suppose we wish
    to evaluate the Jacobian (AKA the gradient because the function returns a scalar)
    at ``[0.5, 0.5, 0.5]``.

    >>> import numpy as np
    >>> from scipy.differentiate import jacobian
    >>> from scipy.optimize import rosen, rosen_der
    >>> m = 3
    >>> x = np.full(m, 0.5)
    >>> res = jacobian(rosen, x)
    >>> ref = rosen_der(x)  # reference value of the gradient
    >>> res.df, ref
    (array([-51.,  -1.,  50.]), array([-51.,  -1.,  50.]))

    As an example of a function with multiple outputs, consider Example 4
    from [1]_.

    >>> def f(x):
    ...     x1, x2, x3 = x
    ...     return [x1, 5*x3, 4*x2**2 - 2*x3, x3*np.sin(x1)]

    The true Jacobian is given by:

    >>> def df(x):
    ...         x1, x2, x3 = x
    ...         one = np.ones_like(x1)
    ...         return [[one, 0*one, 0*one],
    ...                 [0*one, 0*one, 5*one],
    ...                 [0*one, 8*x2, -2*one],
    ...                 [x3*np.cos(x1), 0*one, np.sin(x1)]]

    Evaluate the Jacobian at an arbitrary point.

    >>> rng = np.random.default_rng(389252938452)
    >>> x = rng.random(size=3)
    >>> res = jacobian(f, x)
    >>> ref = df(x)
    >>> res.df.shape == (4, 3)
    True
    >>> np.allclose(res.df, ref)
    True

    Evaluate the Jacobian at 10 arbitrary points in a single call.

    >>> x = rng.random(size=(3, 10))
    >>> res = jacobian(f, x)
    >>> ref = df(x)
    >>> res.df.shape == (4, 3, 10)
    True
    >>> np.allclose(res.df, ref)
    True

    """
    xp = array_namespace(x)
    x0 = xp_promote(x, force_floating=True, xp=xp)

    if x0.ndim < 1:
        message = "Argument `x` must be at least 1-D."
        raise ValueError(message)

    m = x0.shape[0]
    i = xp.arange(m)

    def wrapped(x):
        p = () if x.ndim == x0.ndim else (x.shape[-1],)  # number of abscissae

        new_shape = (m, m) + x0.shape[1:] + p
        xph = xp.expand_dims(x0, axis=1)
        if x.ndim != x0.ndim:
            xph = xp.expand_dims(xph, axis=-1)
        xph = xp_copy(xp.broadcast_to(xph, new_shape), xp=xp)
        xph = xpx.at(xph)[i, i].set(x)
        return f(xph)

    res = derivative(wrapped, x, tolerances=tolerances,
                     maxiter=maxiter, order=order, initial_step=initial_step,
                     step_factor=step_factor, preserve_shape=True,
                     step_direction=step_direction)

    del res.x  # the user knows `x`, and the way it gets broadcasted is meaningless here
    return res


def hessian(f, x, *, tolerances=None, maxiter=10,
            order=8, initial_step=0.5, step_factor=2.0):
    r"""Evaluate the Hessian of a function numerically.

    Parameters
    ----------
    f : callable
        The function whose Hessian is desired. The signature must be::

            f(xi: ndarray) -> ndarray

        where each element of ``xi`` is a finite real. If the function to be
        differentiated accepts additional arguments, wrap it (e.g. using
        `functools.partial` or ``lambda``) and pass the wrapped callable
        into `hessian`. `f` must not mutate the array ``xi``. See Notes
        regarding vectorization and the dimensionality of the input and output.
    x : float array_like
        Points at which to evaluate the Hessian. Must have at least one dimension.
        See Notes regarding the dimensionality and vectorization.
    tolerances : dictionary of floats, optional
        Absolute and relative tolerances. Valid keys of the dictionary are:

        - ``atol`` - absolute tolerance on the derivative
        - ``rtol`` - relative tolerance on the derivative

        Iteration will stop when ``res.error < atol + rtol * abs(res.df)``. The default
        `atol` is the smallest normal number of the appropriate dtype, and
        the default `rtol` is the square root of the precision of the
        appropriate dtype.
    order : int, default: 8
        The (positive integer) order of the finite difference formula to be
        used. Odd integers will be rounded up to the next even integer.
    initial_step : float, default: 0.5
        The (absolute) initial step size for the finite difference derivative
        approximation.
    step_factor : float, default: 2.0
        The factor by which the step size is *reduced* in each iteration; i.e.
        the step size in iteration 1 is ``initial_step/step_factor``. If
        ``step_factor < 1``, subsequent steps will be greater than the initial
        step; this may be useful if steps smaller than some threshold are
        undesirable (e.g. due to subtractive cancellation error).
    maxiter : int, default: 10
        The maximum number of iterations of the algorithm to perform. See
        Notes.

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
            - ``-1`` : The error estimate increased, so iteration was terminated.
            - ``-2`` : The maximum number of iterations was reached.
            - ``-3`` : A non-finite value was encountered.

        ddf : float array
            The Hessian of `f` at `x`, if the algorithm terminated
            successfully.
        error : float array
            An estimate of the error: the magnitude of the difference between
            the current estimate of the Hessian and the estimate in the
            previous iteration.
        nfev : int array
            The number of points at which `f` was evaluated.

        Each element of an attribute is associated with the corresponding
        element of `ddf`. For instance, element ``[i, j]`` of `nfev` is the
        number of points at which `f` was evaluated for the sake of
        computing element ``[i, j]`` of `ddf`.

    See Also
    --------
    derivative, jacobian

    Notes
    -----
    Suppose we wish to evaluate the Hessian of a function
    :math:`f: \mathbf{R}^m \rightarrow \mathbf{R}`, and we assign to variable
    ``m`` the positive integer value of :math:`m`. If we wish to evaluate
    the Hessian at a single point, then:

    - argument `x` must be an array of shape ``(m,)``
    - argument `f` must be vectorized to accept an array of shape
      ``(m, ...)``. The first axis represents the :math:`m` inputs of
      :math:`f`; the remaining axes indicated by ellipses are for evaluating
      the function at several abscissae in a single call.
    - argument `f` must return an array of shape ``(...)``.
    - attribute ``dff`` of the result object will be an array of shape ``(m, m)``,
      the Hessian.

    This function is also vectorized in the sense that the Hessian can be
    evaluated at ``k`` points in a single call. In this case, `x` would be an
    array of shape ``(m, k)``, `f` would accept an array of shape
    ``(m, ...)`` and return an array of shape ``(...)``, and the ``ddf``
    attribute of the result would have shape ``(m, m, k)``. Note that the
    axis associated with the ``k`` points is included within the axes
    denoted by ``(...)``.

    Currently, `hessian` is implemented by nesting calls to `jacobian`.
    All options passed to `hessian` are used for both the inner and outer
    calls with one exception: the `rtol` used in the inner `jacobian` call
    is tightened by a factor of 100 with the expectation that the inner
    error can be ignored. A consequence is that `rtol` should not be set
    less than 100 times the precision of the dtype of `x`; a warning is
    emitted otherwise.

    References
    ----------
    .. [1] Hessian matrix, *Wikipedia*,
           https://en.wikipedia.org/wiki/Hessian_matrix

    Examples
    --------
    The Rosenbrock function maps from :math:`\mathbf{R}^m \rightarrow \mathbf{R}`;
    the SciPy implementation `scipy.optimize.rosen` is vectorized to accept an
    array of shape ``(m, ...)`` and return an array of shape ``...``. Suppose we
    wish to evaluate the Hessian at ``[0.5, 0.5, 0.5]``.

    >>> import numpy as np
    >>> from scipy.differentiate import hessian
    >>> from scipy.optimize import rosen, rosen_hess
    >>> m = 3
    >>> x = np.full(m, 0.5)
    >>> res = hessian(rosen, x)
    >>> ref = rosen_hess(x)  # reference value of the Hessian
    >>> np.allclose(res.ddf, ref)
    True

    `hessian` is vectorized to evaluate the Hessian at multiple points
    in a single call.

    >>> rng = np.random.default_rng(4589245925010)
    >>> x = rng.random((m, 10))
    >>> res = hessian(rosen, x)
    >>> ref = [rosen_hess(xi) for xi in x.T]
    >>> ref = np.moveaxis(ref, 0, -1)
    >>> np.allclose(res.ddf, ref)
    True

    """
    # todo:
    # - add ability to vectorize over additional parameters (*args?)
    # - error estimate stack with inner jacobian (or use legit 2D stencil)

    kwargs = dict(maxiter=maxiter, order=order, initial_step=initial_step,
                  step_factor=step_factor)
    tolerances = {} if tolerances is None else tolerances
    atol = tolerances.get('atol', None)
    rtol = tolerances.get('rtol', None)

    xp = array_namespace(x)
    x0 = xp_promote(x, force_floating=True, xp=xp)

    finfo = xp.finfo(x0.dtype)
    rtol = finfo.eps**0.5 if rtol is None else rtol  # keep same as `derivative`

    # tighten the inner tolerance to make the inner error negligible
    rtol_min = finfo.eps * 100
    message = (f"The specified `{rtol=}`, but error estimates are likely to be "
               f"unreliable when `rtol < {rtol_min}`.")
    if 0 < rtol < rtol_min:  # rtol <= 0 is an error
        warnings.warn(message, RuntimeWarning, stacklevel=2)
        rtol = rtol_min

    def df(x):
        tolerances = dict(rtol=rtol/100, atol=atol)
        temp = jacobian(f, x, tolerances=tolerances, **kwargs)
        nfev.append(temp.nfev if len(nfev) == 0 else temp.nfev.sum(axis=-1))
        return temp.df

    nfev = []  # track inner function evaluations
    res = jacobian(df, x, tolerances=tolerances, **kwargs)  # jacobian of jacobian

    nfev = xp.cumulative_sum(xp.stack(nfev), axis=0)
    res_nit = xp.astype(res.nit[xp.newaxis, ...], xp.int64)  # appease torch
    res.nfev = xp.take_along_axis(nfev, res_nit, axis=0)[0]
    res.ddf = res.df
    del res.df  # this is renamed to ddf
    del res.nit  # this is only the outer-jacobian nit

    return res
