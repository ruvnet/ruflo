from scipy.optimize._bracket import _bracket_root, _bracket_minimum
from scipy.optimize._chandrupatla import _chandrupatla, _chandrupatla_minimize
from scipy._lib._util import _RichResult


def find_root(f, init, /, *, args=(), tolerances=None, maxiter=None, callback=None):
    """Find the root of a monotonic, real-valued function of a real variable.

    For each element of the output of `f`, `find_root` seeks the scalar
    root that makes the element 0. This function currently uses Chandrupatla's
    bracketing algorithm [1]_ and therefore requires argument `init` to
    provide a bracket around the root: the function values at the two endpoints
    must have opposite signs.

    Provided a valid bracket, `find_root` is guaranteed to converge to a solution
    that satisfies the provided `tolerances` if the function is continuous within
    the bracket.

    This function works elementwise when `init` and `args` contain (broadcastable)
    arrays.

    Parameters
    ----------
    f : callable
        The function whose root is desired. The signature must be::

            f(x: array, *args) -> array

        where each element of ``x`` is a finite real and ``args`` is a tuple,
        which may contain an arbitrary number of arrays that are broadcastable
        with ``x``.

        `f` must be an elementwise function: each element ``f(x)[i]``
        must equal ``f(x[i])`` for all indices ``i``. It must not mutate the
        array ``x`` or the arrays in ``args``.

        `find_root` seeks an array ``x`` such that ``f(x)`` is an array of zeros.
    init : 2-tuple of float array_like
        The lower and upper endpoints of a bracket surrounding the desired root.
        A bracket is valid if arrays ``xl, xr = init`` satisfy ``xl < xr`` and
        ``sign(f(xl)) == -sign(f(xr))`` elementwise. Arrays be broadcastable with
        one another and `args`.
    args : tuple of array_like, optional
        Additional positional array arguments to be passed to `f`. Arrays
        must be broadcastable with one another and the arrays of `init`.
        If the callable for which the root is desired requires arguments that are
        not broadcastable with `x`, wrap that callable with `f` such that `f`
        accepts only `x` and broadcastable ``*args``.
    tolerances : dictionary of floats, optional
        Absolute and relative tolerances on the root and function value.
        Valid keys of the dictionary are:

        - ``xatol`` - absolute tolerance on the root
        - ``xrtol`` - relative tolerance on the root
        - ``fatol`` - absolute tolerance on the function value
        - ``frtol`` - relative tolerance on the function value

        See Notes for default values and explicit termination conditions.
    maxiter : int, optional
        The maximum number of iterations of the algorithm to perform.
        The default is the maximum possible number of bisections within
        the (normal) floating point numbers of the relevant dtype.
    callback : callable, optional
        An optional user-supplied function to be called before the first
        iteration and after each iteration.
        Called as ``callback(res)``, where ``res`` is a ``_RichResult``
        similar to that returned by `find_root` (but containing the current
        iterate's values of all variables). If `callback` raises a
        ``StopIteration``, the algorithm will terminate immediately and
        `find_root` will return a result. `callback` must not mutate
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
            - ``-1`` : The initial bracket was invalid.
            - ``-2`` : The maximum number of iterations was reached.
            - ``-3`` : A non-finite value was encountered.
            - ``-4`` : Iteration was terminated by `callback`.
            - ``1`` : The algorithm is proceeding normally (in `callback` only).

        x : float array
            The root of the function, if the algorithm terminated successfully.
        f_x : float array
            The value of `f` evaluated at `x`.
        nfev : int array
            The number of abscissae at which `f` was evaluated to find the root.
            This is distinct from the number of times `f` is *called* because the
            the function may evaluated at multiple points in a single call.
        nit : int array
            The number of iterations of the algorithm that were performed.
        bracket : tuple of float arrays
            The lower and upper endpoints of the final bracket.
        f_bracket : tuple of float arrays
            The value of `f` evaluated at the lower and upper endpoints of the
            bracket.

    Notes
    -----
    Implemented based on Chandrupatla's original paper [1]_.

    Let:

    -  ``a, b = init`` be the left and right endpoints of the initial bracket,
    - ``xl`` and ``xr`` be the left and right endpoints of the final bracket,
    - ``xmin = xl if abs(f(xl)) <= abs(f(xr)) else xr`` be the final bracket
      endpoint with the smaller function value, and
    - ``fmin0 = min(f(a), f(b))`` be the minimum of the two values of the
      function evaluated at the initial bracket endpoints.

    Then the algorithm is considered to have converged when

    - ``abs(xr - xl) < xatol + abs(xmin) * xrtol`` or
    - ``fun(xmin) <= fatol + abs(fmin0) * frtol``.

    This is equivalent to the termination condition described in [1]_ with
    ``xrtol = 4e-10``, ``xatol = 1e-5``, and ``fatol = frtol = 0``.
    However, the default values of the `tolerances` dictionary are
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
    bracket_root

    Examples
    --------
    Suppose we wish to find the root of the following function.

    >>> def f(x, c=5):
    ...     return x**3 - 2*x - c

    First, we must find a valid bracket. The function is not monotonic,
    but `bracket_root` may be able to provide a bracket.

    >>> from scipy.optimize import elementwise
    >>> res_bracket = elementwise.bracket_root(f, 0)
    >>> res_bracket.success
    True
    >>> res_bracket.bracket
    (2.0, 4.0)

    Indeed, the values of the function at the bracket endpoints have
    opposite signs.

    >>> res_bracket.f_bracket
    (-1.0, 51.0)

    Once we have a valid bracket, `find_root` can be used to provide
    a precise root.

    >>> res_root = elementwise.find_root(f, res_bracket.bracket)
    >>> res_root.x
    2.0945514815423265

    The final bracket is only a few ULPs wide, so the error between
    this value and the true root cannot be much smaller within values
    that are representable in double precision arithmetic.

    >>> import numpy as np
    >>> xl, xr = res_root.bracket
    >>> (xr - xl) / np.spacing(xl)
    2.0
    >>> res_root.f_bracket
    (-8.881784197001252e-16, 9.769962616701378e-15)

    `bracket_root` and `find_root` accept arrays for most arguments.
    For instance, to find the root for a few values of the parameter ``c``
    at once:

    >>> c = np.asarray([3, 4, 5])
    >>> res_bracket = elementwise.bracket_root(f, 0, args=(c,))
    >>> res_bracket.bracket
    (array([1., 1., 2.]), array([2., 2., 4.]))
    >>> res_root = elementwise.find_root(f, res_bracket.bracket, args=(c,))
    >>> res_root.x
    array([1.8932892 , 2.        , 2.09455148])

    """

    def reformat_result(res_in):
        res_out = _RichResult()
        res_out.status = res_in.status
        res_out.success = res_in.success
        res_out.x = res_in.x
        res_out.f_x = res_in.fun
        res_out.nfev = res_in.nfev
        res_out.nit = res_in.nit
        res_out.bracket = (res_in.xl, res_in.xr)
        res_out.f_bracket = (res_in.fl, res_in.fr)
        res_out._order_keys = ['success', 'status', 'x', 'f_x',
                               'nfev', 'nit', 'bracket', 'f_bracket']
        return res_out

    xl, xr = init
    default_tolerances = dict(xatol=None, xrtol=None, fatol=None, frtol=0)
    tolerances = {} if tolerances is None else tolerances
    default_tolerances.update(tolerances)
    tolerances = default_tolerances

    if callable(callback):
        def _callback(res):
            return callback(reformat_result(res))
    else:
        _callback = callback

    res = _chandrupatla(f, xl, xr, args=args, **tolerances,
                        maxiter=maxiter, callback=_callback)
    return reformat_result(res)


def find_minimum(f, init, /, *, args=(), tolerances=None, maxiter=100, callback=None):
    """Find the minimum of an unimodal, real-valued function of a real variable.

    For each element of the output of `f`, `find_minimum` seeks the scalar minimizer
    that minimizes the element. This function currently uses Chandrupatla's
    bracketing minimization algorithm [1]_ and therefore requires argument `init`
    to provide a three-point minimization bracket: ``x1 < x2 < x3`` such that
    ``func(x1) >= func(x2) <= func(x3)``, where one of the inequalities is strict.

    Provided a valid bracket, `find_minimum` is guaranteed to converge to a local
    minimum that satisfies the provided `tolerances` if the function is continuous
    within the bracket.

    This function works elementwise when `init` and `args` contain (broadcastable)
    arrays.

    Parameters
    ----------
    f : callable
        The function whose minimizer is desired. The signature must be::

            f(x: array, *args) -> array

        where each element of ``x`` is a finite real and ``args`` is a tuple,
        which may contain an arbitrary number of arrays that are broadcastable
        with ``x``.

        `f` must be an elementwise function: each element ``f(x)[i]``
        must equal ``f(x[i])`` for all indices ``i``. It must not mutate the
        array ``x`` or the arrays in ``args``.

        `find_minimum` seeks an array ``x`` such that ``f(x)`` is an array of
        local minima.
    init : 3-tuple of float array_like
        The abscissae of a standard scalar minimization bracket. A bracket is
        valid if arrays ``x1, x2, x3 = init`` satisfy ``x1 < x2 < x3`` and
        ``func(x1) >= func(x2) <= func(x3)``, where one of the inequalities
        is strict. Arrays must be broadcastable with one another and the arrays
        of `args`.
    args : tuple of array_like, optional
        Additional positional array arguments to be passed to `f`. Arrays
        must be broadcastable with one another and the arrays of `init`.
        If the callable for which the root is desired requires arguments that are
        not broadcastable with `x`, wrap that callable with `f` such that `f`
        accepts only `x` and broadcastable ``*args``.
    tolerances : dictionary of floats, optional
        Absolute and relative tolerances on the root and function value.
        Valid keys of the dictionary are:

        - ``xatol`` - absolute tolerance on the root
        - ``xrtol`` - relative tolerance on the root
        - ``fatol`` - absolute tolerance on the function value
        - ``frtol`` - relative tolerance on the function value

        See Notes for default values and explicit termination conditions.
    maxiter : int, default: 100
        The maximum number of iterations of the algorithm to perform.
    callback : callable, optional
        An optional user-supplied function to be called before the first
        iteration and after each iteration.
        Called as ``callback(res)``, where ``res`` is a ``_RichResult``
        similar to that returned by `find_minimum` (but containing the current
        iterate's values of all variables). If `callback` raises a
        ``StopIteration``, the algorithm will terminate immediately and
        `find_root` will return a result. `callback` must not mutate
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
            - ``-1`` : The algorithm encountered an invalid bracket.
            - ``-2`` : The maximum number of iterations was reached.
            - ``-3`` : A non-finite value was encountered.
            - ``-4`` : Iteration was terminated by `callback`.
            - ``1`` : The algorithm is proceeding normally (in `callback` only).

        x : float array
            The minimizer of the function, if the algorithm terminated successfully.
        f_x : float array
            The value of `f` evaluated at `x`.
        nfev : int array
            The number of abscissae at which `f` was evaluated to find the root.
            This is distinct from the number of times `f` is *called* because the
            the function may evaluated at multiple points in a single call.
        nit : int array
            The number of iterations of the algorithm that were performed.
        bracket : tuple of float arrays
            The final three-point bracket.
        f_bracket : tuple of float arrays
            The value of `f` evaluated at the bracket points.

    Notes
    -----
    Implemented based on Chandrupatla's original paper [1]_.

    If ``xl < xm < xr`` are the points of the bracket and ``fl >= fm <= fr``
    (where one of the inequalities is strict) are the values of `f` evaluated
    at those points, then the algorithm is considered to have converged when:

    - ``abs(xr - xm)/2 <= abs(xm)*xrtol + xatol`` or
    - ``(fl - 2*fm + fr)/2 <= abs(fm)*frtol + fatol``.

    The default value of `xrtol` is the square root of the precision of the
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
    bracket_minimum

    Examples
    --------
    Suppose we wish to minimize the following function.

    >>> def f(x, c=1):
    ...     return (x - c)**2 + 2

    First, we must find a valid bracket. The function is unimodal,
    so `bracket_minium` will easily find a bracket.

    >>> from scipy.optimize import elementwise
    >>> res_bracket = elementwise.bracket_minimum(f, 0)
    >>> res_bracket.success
    True
    >>> res_bracket.bracket
    (0.0, 0.5, 1.5)

    Indeed, the bracket points are ordered and the function value
    at the middle bracket point is less than at the surrounding
    points.

    >>> xl, xm, xr = res_bracket.bracket
    >>> fl, fm, fr = res_bracket.f_bracket
    >>> (xl < xm < xr) and (fl > fm <= fr)
    True

    Once we have a valid bracket, `find_minimum` can be used to provide
    an estimate of the minimizer.

    >>> res_minimum = elementwise.find_minimum(f, res_bracket.bracket)
    >>> res_minimum.x
    1.0000000149011612

    The function value changes by only a few ULPs within the bracket, so
    the minimizer cannot be determined much more precisely by evaluating
    the function alone (i.e. we would need its derivative to do better).

    >>> import numpy as np
    >>> fl, fm, fr = res_minimum.f_bracket
    >>> (fl - fm) / np.spacing(fm), (fr - fm) / np.spacing(fm)
    (0.0, 2.0)

    Therefore, a precise minimum of the function is given by:

    >>> res_minimum.f_x
    2.0

    `bracket_minimum` and `find_minimum` accept arrays for most arguments.
    For instance, to find the minimizers and minima for a few values of the
    parameter ``c`` at once:

    >>> c = np.asarray([1, 1.5, 2])
    >>> res_bracket = elementwise.bracket_minimum(f, 0, args=(c,))
    >>> res_bracket.bracket
    (array([0. , 0.5, 0.5]), array([0.5, 1.5, 1.5]), array([1.5, 2.5, 2.5]))
    >>> res_minimum = elementwise.find_minimum(f, res_bracket.bracket, args=(c,))
    >>> res_minimum.x
    array([1.00000001, 1.5       , 2.        ])
    >>> res_minimum.f_x
    array([2., 2., 2.])

    """

    def reformat_result(res_in):
        res_out = _RichResult()
        res_out.status = res_in.status
        res_out.success = res_in.success
        res_out.x = res_in.x
        res_out.f_x = res_in.fun
        res_out.nfev = res_in.nfev
        res_out.nit = res_in.nit
        res_out.bracket = (res_in.xl, res_in.xm, res_in.xr)
        res_out.f_bracket = (res_in.fl, res_in.fm, res_in.fr)
        res_out._order_keys = ['success', 'status', 'x', 'f_x',
                               'nfev', 'nit', 'bracket', 'f_bracket']
        return res_out

    xl, xm, xr = init
    default_tolerances = dict(xatol=None, xrtol=None, fatol=None, frtol=None)
    tolerances = {} if tolerances is None else tolerances
    default_tolerances.update(tolerances)
    tolerances = default_tolerances

    if callable(callback):
        def _callback(res):
            return callback(reformat_result(res))
    else:
        _callback = callback

    res = _chandrupatla_minimize(f, xl, xm, xr, args=args, **tolerances,
                                 maxiter=maxiter, callback=_callback)
    return reformat_result(res)


def bracket_root(f, xl0, xr0=None, *, xmin=None, xmax=None, factor=None, args=(),
                 maxiter=1000):
    """Bracket the root of a monotonic, real-valued function of a real variable.

    For each element of the output of `f`, `bracket_root` seeks the scalar
    bracket endpoints ``xl`` and ``xr`` such that ``sign(f(xl)) == -sign(f(xr))``
    elementwise.

    The function is guaranteed to find a valid bracket if the function is monotonic,
    but it may find a bracket under other conditions.

    This function works elementwise when `xl0`, `xr0`, `xmin`, `xmax`, `factor`, and
    the elements of `args` are (mutually broadcastable) arrays.

    Parameters
    ----------
    f : callable
        The function for which the root is to be bracketed. The signature must be::

            f(x: array, *args) -> array

        where each element of ``x`` is a finite real and ``args`` is a tuple,
        which may contain an arbitrary number of arrays that are broadcastable
        with ``x``.

        `f` must be an elementwise function: each element ``f(x)[i]``
        must equal ``f(x[i])`` for all indices ``i``. It must not mutate the
        array ``x`` or the arrays in ``args``.
    xl0, xr0: float array_like
        Starting guess of bracket, which need not contain a root. If `xr0` is
        not provided, ``xr0 = xl0 + 1``. Must be broadcastable with all other
        array inputs.
    xmin, xmax : float array_like, optional
        Minimum and maximum allowable endpoints of the bracket, inclusive. Must
        be broadcastable with all other array inputs.
    factor : float array_like, default: 2
        The factor used to grow the bracket. See Notes.
    args : tuple of array_like, optional
        Additional positional array arguments to be passed to `f`.
        If the callable for which the root is desired requires arguments that are
        not broadcastable with `x`, wrap that callable with `f` such that `f`
        accepts only `x` and broadcastable ``*args``.
    maxiter : int, default: 1000
        The maximum number of iterations of the algorithm to perform.

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

            - ``0`` : The algorithm produced a valid bracket.
            - ``-1`` : The bracket expanded to the allowable limits without success.
            - ``-2`` : The maximum number of iterations was reached.
            - ``-3`` : A non-finite value was encountered.
            - ``-4`` : Iteration was terminated by `callback`.
            - ``-5``: The initial bracket does not satisfy`xmin <= xl0 < xr0 < xmax`.
            
        bracket : 2-tuple of float arrays
            The lower and upper endpoints of the bracket, if the algorithm
            terminated successfully.
        f_bracket : 2-tuple of float arrays
            The values of `f` evaluated at the endpoints of ``res.bracket``,
            respectively.
        nfev : int array
            The number of abscissae at which `f` was evaluated to find the root.
            This is distinct from the number of times `f` is *called* because the
            the function may evaluated at multiple points in a single call.
        nit : int array
            The number of iterations of the algorithm that were performed.

    Notes
    -----
    This function generalizes an algorithm found in pieces throughout the
    `scipy.stats` codebase. The strategy is to iteratively grow the bracket `(l, r)`
    until ``f(l) < 0 < f(r)`` or ``f(r) < 0 < f(l)``. The bracket grows to the left
    as follows.

    - If `xmin` is not provided, the distance between `xl0` and `l` is iteratively
      increased by `factor`.
    - If `xmin` is provided, the distance between `xmin` and `l` is iteratively
      decreased by `factor`. Note that this also *increases* the bracket size.

    Growth of the bracket to the right is analogous.

    Growth of the bracket in one direction stops when the endpoint is no longer
    finite, the function value at the endpoint is no longer finite, or the
    endpoint reaches its limiting value (`xmin` or `xmax`). Iteration terminates
    when the bracket stops growing in both directions, the bracket surrounds
    the root, or a root is found (by chance).

    If two brackets are found - that is, a bracket is found on both sides in
    the same iteration, the smaller of the two is returned.
    
    If roots of the function are found, both `xl` and `xr` are set to the
    leftmost root.
    
    See Also
    --------
    find_root

    Examples
    --------
    Suppose we wish to find the root of the following function.

    >>> def f(x, c=5):
    ...     return x**3 - 2*x - c

    First, we must find a valid bracket. The function is not monotonic,
    but `bracket_root` may be able to provide a bracket.

    >>> from scipy.optimize import elementwise
    >>> res_bracket = elementwise.bracket_root(f, 0)
    >>> res_bracket.success
    True
    >>> res_bracket.bracket
    (2.0, 4.0)

    Indeed, the values of the function at the bracket endpoints have
    opposite signs.

    >>> res_bracket.f_bracket
    (-1.0, 51.0)

    Once we have a valid bracket, `find_root` can be used to provide
    a precise root.

    >>> res_root = elementwise.find_root(f, res_bracket.bracket)
    >>> res_root.x
    2.0945514815423265

    `bracket_root` and `find_root` accept arrays for most arguments.
    For instance, to find the root for a few values of the parameter ``c``
    at once:

    >>> import numpy as np
    >>> c = np.asarray([3, 4, 5])
    >>> res_bracket = elementwise.bracket_root(f, 0, args=(c,))
    >>> res_bracket.bracket
    (array([1., 1., 2.]), array([2., 2., 4.]))
    >>> res_root = elementwise.find_root(f, res_bracket.bracket, args=(c,))
    >>> res_root.x
    array([1.8932892 , 2.        , 2.09455148])

    """  # noqa: E501

    res = _bracket_root(f, xl0, xr0=xr0, xmin=xmin, xmax=xmax, factor=factor,
                        args=args, maxiter=maxiter)
    res.bracket = res.xl, res.xr
    res.f_bracket = res.fl, res.fr
    del res.xl
    del res.xr
    del res.fl
    del res.fr
    return res


def bracket_minimum(f, xm0, *, xl0=None, xr0=None, xmin=None, xmax=None,
                     factor=None, args=(), maxiter=1000):
    """Bracket the minimum of a unimodal, real-valued function of a real variable.

    For each element of the output of `f`, `bracket_minimum` seeks the scalar
    bracket points ``xl < xm < xr`` such that ``fl >= fm <= fr`` where one of the
    inequalities is strict.

    The function is guaranteed to find a valid bracket if the function is
    strongly unimodal, but it may find a bracket under other conditions.

    This function works elementwise when `xm0`, `xl0`, `xr0`, `xmin`, `xmax`, `factor`,
    and the elements of `args` are (mutually broadcastable) arrays.

    Parameters
    ----------
    f : callable
        The function for which the root is to be bracketed. The signature must be::

            f(x: array, *args) -> array

        where each element of ``x`` is a finite real and ``args`` is a tuple,
        which may contain an arbitrary number of arrays that are broadcastable
        with ``x``.

        `f` must be an elementwise function: each element ``f(x)[i]``
        must equal ``f(x[i])`` for all indices ``i``. It must not mutate the
        array ``x`` or the arrays in ``args``.
    xm0: float array_like
        Starting guess for middle point of bracket.
    xl0, xr0: float array_like, optional
        Starting guesses for left and right endpoints of the bracket. Must
        be broadcastable with all other array inputs.
    xmin, xmax : float array_like, optional
        Minimum and maximum allowable endpoints of the bracket, inclusive. Must
        be broadcastable with all other array inputs.
    factor : float array_like, default: 2
        The factor used to grow the bracket. See Notes.
    args : tuple of array_like, optional
        Additional positional array arguments to be passed to `f`.
        If the callable for which the root is desired requires arguments that are
        not broadcastable with `x`, wrap that callable with `f` such that `f`
        accepts only `x` and broadcastable ``*args``.
    maxiter : int, default: 1000
        The maximum number of iterations of the algorithm to perform.

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

            - ``0`` : The algorithm produced a valid bracket.
            - ``-1`` : The bracket expanded to the allowable limits. Assuming
              unimodality, this implies the endpoint at the limit is a minimizer.
            - ``-2`` : The maximum number of iterations was reached.
            - ``-3`` : A non-finite value was encountered.
            - ``-4`` : ``None`` shall pass.
            - ``-5`` : The initial bracket does not satisfy
              `xmin <= xl0 < xm0 < xr0 <= xmax`.

        bracket : 3-tuple of float arrays
            The left, middle, and right points of the bracket, if the algorithm
            terminated successfully.
        f_bracket : 3-tuple of float arrays
            The function value at the left, middle, and right points of the bracket.
        nfev : int array
            The number of abscissae at which `f` was evaluated to find the root.
            This is distinct from the number of times `f` is *called* because the
            the function may evaluated at multiple points in a single call.
        nit : int array
            The number of iterations of the algorithm that were performed.

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

    See Also
    --------
    scipy.optimize.bracket
    scipy.optimize.elementwise.find_minimum

    Examples
    --------
    Suppose we wish to minimize the following function.

    >>> def f(x, c=1):
    ...     return (x - c)**2 + 2

    First, we must find a valid bracket. The function is unimodal,
    so `bracket_minium` will easily find a bracket.

    >>> from scipy.optimize import elementwise
    >>> res_bracket = elementwise.bracket_minimum(f, 0)
    >>> res_bracket.success
    True
    >>> res_bracket.bracket
    (0.0, 0.5, 1.5)

    Indeed, the bracket points are ordered and the function value
    at the middle bracket point is less than at the surrounding
    points.

    >>> xl, xm, xr = res_bracket.bracket
    >>> fl, fm, fr = res_bracket.f_bracket
    >>> (xl < xm < xr) and (fl > fm <= fr)
    True

    Once we have a valid bracket, `find_minimum` can be used to provide
    an estimate of the minimizer.

    >>> res_minimum = elementwise.find_minimum(f, res_bracket.bracket)
    >>> res_minimum.x
    1.0000000149011612

    `bracket_minimum` and `find_minimum` accept arrays for most arguments.
    For instance, to find the minimizers and minima for a few values of the
    parameter ``c`` at once:

    >>> import numpy as np
    >>> c = np.asarray([1, 1.5, 2])
    >>> res_bracket = elementwise.bracket_minimum(f, 0, args=(c,))
    >>> res_bracket.bracket
    (array([0. , 0.5, 0.5]), array([0.5, 1.5, 1.5]), array([1.5, 2.5, 2.5]))
    >>> res_minimum = elementwise.find_minimum(f, res_bracket.bracket, args=(c,))
    >>> res_minimum.x
    array([1.00000001, 1.5       , 2.        ])
    >>> res_minimum.f_x
    array([2., 2., 2.])

    """  # noqa: E501

    res = _bracket_minimum(f, xm0, xl0=xl0, xr0=xr0, xmin=xmin, xmax=xmax,
                           factor=factor, args=args, maxiter=maxiter)
    res.bracket = res.xl, res.xm, res.xr
    res.f_bracket = res.fl, res.fm, res.fr
    del res.xl
    del res.xm
    del res.xr
    del res.fl
    del res.fm
    del res.fr
    return res
