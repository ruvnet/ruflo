# `_elementwise_iterative_method.py` includes tools for writing functions that
# - are vectorized to work elementwise on arrays,
# - implement non-trivial, iterative algorithms with a callback interface, and
# - return rich objects with iteration count, termination status, etc.
#
# Examples include:
# `scipy.optimize._chandrupatla._chandrupatla for scalar rootfinding,
# `scipy.optimize._chandrupatla._chandrupatla_minimize for scalar minimization,
# `scipy.optimize._differentiate._differentiate for numerical differentiation,
# `scipy.optimize._bracket._bracket_root for finding rootfinding brackets,
# `scipy.optimize._bracket._bracket_minimize for finding minimization brackets,
# `scipy.integrate._tanhsinh._tanhsinh` for numerical quadrature,
# `scipy.differentiate.derivative` for finite difference based differentiation.

import math
import numpy as np
from ._util import _RichResult, _call_callback_maybe_halt
from ._array_api import array_namespace, xp_size, xp_result_type
import scipy._lib.array_api_extra as xpx

_ESIGNERR = -1
_ECONVERR = -2
_EVALUEERR = -3
_ECALLBACK = -4
_EINPUTERR = -5
_ECONVERGED = 0
_EINPROGRESS = 1

def _initialize(func, xs, args, complex_ok=False, preserve_shape=None, xp=None):
    """Initialize abscissa, function, and args arrays for elementwise function

    Parameters
    ----------
    func : callable
        An elementwise function with signature

            func(x: ndarray, *args) -> ndarray

        where each element of ``x`` is a finite real and ``args`` is a tuple,
        which may contain an arbitrary number of arrays that are broadcastable
        with ``x``.
    xs : tuple of arrays
        Finite real abscissa arrays. Must be broadcastable.
    args : tuple, optional
        Additional positional arguments to be passed to `func`.
    preserve_shape : bool, default:False
        When ``preserve_shape=False`` (default), `func` may be passed
        arguments of any shape; `_scalar_optimization_loop` is permitted
        to reshape and compress arguments at will. When
        ``preserve_shape=False``, arguments passed to `func` must have shape
        `shape` or ``shape + (n,)``, where ``n`` is any integer.
    xp : namespace
        Namespace of array arguments in `xs`.

    Returns
    -------
    xs, fs, args : tuple of arrays
        Broadcasted, writeable, 1D abscissa and function value arrays (or
        NumPy floats, if appropriate). The dtypes of the `xs` and `fs` are
        `xfat`; the dtype of the `args` are unchanged.
    shape : tuple of ints
        Original shape of broadcasted arrays.
    xfat : NumPy dtype
        Result dtype of abscissae, function values, and args determined using
        `np.result_type`, except integer types are promoted to `np.float64`.

    Raises
    ------
    ValueError
        If the result dtype is not that of a real scalar

    Notes
    -----
    Useful for initializing the input of SciPy functions that accept
    an elementwise callable, abscissae, and arguments; e.g.
    `scipy.optimize._chandrupatla`.
    """
    nx = len(xs)
    xp = array_namespace(*xs) if xp is None else xp

    # Try to preserve `dtype`, but we need to ensure that the arguments are at
    # least floats before passing them into the function; integers can overflow
    # and cause failure.
    # There might be benefit to combining the `xs` into a single array and
    # calling `func` once on the combined array. For now, keep them separate.
    xat = xp_result_type(*xs, force_floating=True, xp=xp)
    xas = xp.broadcast_arrays(*xs, *args)  # broadcast and rename
    xs, args = xas[:nx], xas[nx:]
    xs = [xp.asarray(x, dtype=xat) for x in xs]  # use copy=False when implemented
    fs = [xp.asarray(func(x, *args)) for x in xs]
    shape = xs[0].shape
    fshape = fs[0].shape

    if preserve_shape:
        # bind original shape/func now to avoid late-binding gotcha
        def func(x, *args, shape=shape, func=func,  **kwargs):
            i = (0,)*(len(fshape) - len(shape))
            return func(x[i], *args, **kwargs)
        shape = np.broadcast_shapes(fshape, shape)  # just shapes; use of NumPy OK
        xs = [xp.broadcast_to(x, shape) for x in xs]
        args = [xp.broadcast_to(arg, shape) for arg in args]

    message = ("The shape of the array returned by `func` must be the same as "
               "the broadcasted shape of `x` and all other `args`.")
    if preserve_shape is not None:  # only in tanhsinh for now
        message = f"When `preserve_shape=False`, {message.lower()}"
    shapes_equal = [f.shape == shape for f in fs]
    if not all(shapes_equal):  # use Python all to reduce overhead
        raise ValueError(message)

    # These algorithms tend to mix the dtypes of the abscissae and function
    # values, so figure out what the result will be and convert them all to
    # that type from the outset.
    xfat = xp.result_type(*([f.dtype for f in fs] + [xat]))
    if not complex_ok and not xp.isdtype(xfat, "real floating"):
        raise ValueError("Abscissae and function output must be real numbers.")
    xs = [xp.asarray(x, dtype=xfat, copy=True) for x in xs]
    fs = [xp.asarray(f, dtype=xfat, copy=True) for f in fs]

    # To ensure that we can do indexing, we'll work with at least 1d arrays,
    # but remember the appropriate shape of the output.
    xs = [xp.reshape(x, (-1,)) for x in xs]
    fs = [xp.reshape(f, (-1,)) for f in fs]
    args = [xp.reshape(xp.asarray(arg, copy=True), (-1,)) for arg in args]
    return func, xs, fs, args, shape, xfat, xp


def _loop(work, callback, shape, maxiter, func, args, dtype, pre_func_eval,
          post_func_eval, check_termination, post_termination_check,
          customize_result, res_work_pairs, xp, preserve_shape=False):
    """Main loop of a vectorized scalar optimization algorithm

    Parameters
    ----------
    work : _RichResult
        All variables that need to be retained between iterations. Must
        contain attributes `nit`, `nfev`, and `success`. All arrays are
        subject to being "compressed" if `preserve_shape is False`; nest
        arrays that should not be compressed inside another object (e.g.
        `dict` or `_RichResult`).
    callback : callable
        User-specified callback function
    shape : tuple of ints
        The shape of all output arrays
    maxiter :
        Maximum number of iterations of the algorithm
    func : callable
        The user-specified callable that is being optimized or solved
    args : tuple
        Additional positional arguments to be passed to `func`.
    dtype : NumPy dtype
        The common dtype of all abscissae and function values
    pre_func_eval : callable
        A function that accepts `work` and returns `x`, the active elements
        of `x` at which `func` will be evaluated. May modify attributes
        of `work` with any algorithmic steps that need to happen
         at the beginning of an iteration, before `func` is evaluated,
    post_func_eval : callable
        A function that accepts `x`, `func(x)`, and `work`. May modify
        attributes of `work` with any algorithmic steps that need to happen
         in the middle of an iteration, after `func` is evaluated but before
         the termination check.
    check_termination : callable
        A function that accepts `work` and returns `stop`, a boolean array
        indicating which of the active elements have met a termination
        condition.
    post_termination_check : callable
        A function that accepts `work`. May modify `work` with any algorithmic
        steps that need to happen after the termination check and before the
        end of the iteration.
    customize_result : callable
        A function that accepts `res` and `shape` and returns `shape`. May
        modify `res` (in-place) according to preferences (e.g. rearrange
        elements between attributes) and modify `shape` if needed.
    res_work_pairs : list of (str, str)
        Identifies correspondence between attributes of `res` and attributes
        of `work`; i.e., attributes of active elements of `work` will be
        copied to the appropriate indices of `res` when appropriate. The order
        determines the order in which _RichResult attributes will be
        pretty-printed.
    preserve_shape : bool, default: False
        Whether to compress the attributes of `work` (to avoid unnecessary
        computation on elements that have already converged).

    Returns
    -------
    res : _RichResult
        The final result object

    Notes
    -----
    Besides providing structure, this framework provides several important
    services for a vectorized optimization algorithm.

    - It handles common tasks involving iteration count, function evaluation
      count, a user-specified callback, and associated termination conditions.
    - It compresses the attributes of `work` to eliminate unnecessary
      computation on elements that have already converged.

    """
    if xp is None:
        raise NotImplementedError("Must provide xp.")

    cb_terminate = False

    # Initialize the result object and active element index array
    n_elements = math.prod(shape)
    active = xp.arange(n_elements)  # in-progress element indices
    res_dict = {i: xp.zeros(n_elements, dtype=dtype) for i, j in res_work_pairs}
    res_dict['success'] = xp.zeros(n_elements, dtype=xp.bool)
    res_dict['status'] = xp.full(n_elements, xp.asarray(_EINPROGRESS), dtype=xp.int32)
    res_dict['nit'] = xp.zeros(n_elements, dtype=xp.int32)
    res_dict['nfev'] = xp.zeros(n_elements, dtype=xp.int32)
    res = _RichResult(res_dict)
    work.args = args

    active = _check_termination(work, res, res_work_pairs, active,
                                check_termination, preserve_shape, xp)

    if callback is not None:
        temp = _prepare_result(work, res, res_work_pairs, active, shape,
                               customize_result, preserve_shape, xp)
        if _call_callback_maybe_halt(callback, temp):
            cb_terminate = True

    while work.nit < maxiter and xp_size(active) and not cb_terminate and n_elements:
        x = pre_func_eval(work)

        if work.args and work.args[0].ndim != x.ndim:
            # `x` always starts as 1D. If the SciPy function that uses
            # _loop added dimensions to `x`, we need to
            # add them to the elements of `args`.
            args = []
            for arg in work.args:
                n_new_dims = x.ndim - arg.ndim
                new_shape = arg.shape + (1,)*n_new_dims
                args.append(xp.reshape(arg, new_shape))
            work.args = args

        x_shape = x.shape
        if preserve_shape:
            x = xp.reshape(x, (shape + (-1,)))
        f = func(x, *work.args)
        f = xp.asarray(f, dtype=dtype)
        if preserve_shape:
            x = xp.reshape(x, x_shape)
            f = xp.reshape(f, x_shape)
        work.nfev += 1 if x.ndim == 1 else x.shape[-1]

        post_func_eval(x, f, work)

        work.nit += 1
        active = _check_termination(work, res, res_work_pairs, active,
                                    check_termination, preserve_shape, xp)

        if callback is not None:
            temp = _prepare_result(work, res, res_work_pairs, active, shape,
                                   customize_result, preserve_shape, xp)
            if _call_callback_maybe_halt(callback, temp):
                cb_terminate = True
                break
        if xp_size(active) == 0:
            break

        post_termination_check(work)

    work.status = xpx.at(work.status)[:].set(_ECALLBACK if cb_terminate else _ECONVERR)
    return _prepare_result(work, res, res_work_pairs, active, shape,
                           customize_result, preserve_shape, xp)


def _check_termination(work, res, res_work_pairs, active, check_termination,
                       preserve_shape, xp):
    # Checks termination conditions, updates elements of `res` with
    # corresponding elements of `work`, and compresses `work`.

    stop = check_termination(work)

    if xp.any(stop):
        # update the active elements of the result object with the active
        # elements for which a termination condition has been met
        _update_active(work, res, res_work_pairs, active, stop, preserve_shape, xp)

        if preserve_shape:
            stop = stop[active]

        proceed = ~stop
        active = active[proceed]

        if not preserve_shape:
            # compress the arrays to avoid unnecessary computation
            for key, val in work.items():
                # `continued_fraction` hacks `n`; improve if this becomes a problem
                if key in {'args', 'n'}:
                    continue
                work[key] = val[proceed] if getattr(val, 'ndim', 0) > 0 else val
            work.args = [arg[proceed] for arg in work.args]

    return active


def _update_active(work, res, res_work_pairs, active, mask, preserve_shape, xp):
    # Update `active` indices of the arrays in result object `res` with the
    # contents of the scalars and arrays in `update_dict`. When provided,
    # `mask` is a boolean array applied both to the arrays in `update_dict`
    # that are to be used and to the arrays in `res` that are to be updated.
    update_dict = {key1: work[key2] for key1, key2 in res_work_pairs}
    update_dict['success'] = work.status == 0

    if mask is not None:
        if preserve_shape:
            active_mask = xp.zeros_like(mask)
            active_mask = xpx.at(active_mask)[active].set(True)
            active_mask = active_mask & mask
            for key, val in update_dict.items():
                val = val[active_mask] if getattr(val, 'ndim', 0) > 0 else val
                res[key] = xpx.at(res[key])[active_mask].set(val)
        else:
            active_mask = active[mask]
            for key, val in update_dict.items():
                val = val[mask] if getattr(val, 'ndim', 0) > 0 else val
                res[key] = xpx.at(res[key])[active_mask].set(val)
    else:
        for key, val in update_dict.items():
            if preserve_shape and getattr(val, 'ndim', 0) > 0:
                val = val[active]
            res[key] = xpx.at(res[key])[active].set(val)


def _prepare_result(work, res, res_work_pairs, active, shape, customize_result,
                    preserve_shape, xp):
    # Prepare the result object `res` by creating a copy, copying the latest
    # data from work, running the provided result customization function,
    # and reshaping the data to the original shapes.
    res = res.copy()
    _update_active(work, res, res_work_pairs, active, None, preserve_shape, xp)

    shape = customize_result(res, shape)

    for key, val in res.items():
        # this looks like it won't work for xp != np if val is not numeric
        temp = xp.reshape(val, shape)
        res[key] = temp[()] if temp.ndim == 0 else temp

    res['_order_keys'] = ['success'] + [i for i, j in res_work_pairs]
    return _RichResult(**res)
