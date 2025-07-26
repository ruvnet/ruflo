import re
from contextlib import contextmanager
import functools
import operator
import warnings
import numbers
from collections import namedtuple
import inspect
import math
from types import ModuleType
from typing import Literal, TypeAlias, TypeVar

import numpy as np
from scipy._lib._array_api import (Array, array_namespace, is_lazy_array,
                                   is_numpy, is_marray, xp_result_device,
                                   xp_size, xp_result_type)
from scipy._lib._docscrape import FunctionDoc, Parameter
from scipy._lib._sparse import issparse

from numpy.exceptions import AxisError


np_long: type
np_ulong: type

if np.lib.NumpyVersion(np.__version__) >= "2.0.0.dev0":
    try:
        with warnings.catch_warnings():
            warnings.filterwarnings(
                "ignore",
                r".*In the future `np\.long` will be defined as.*",
                FutureWarning,
            )
            np_long = np.long  # type: ignore[attr-defined]
            np_ulong = np.ulong  # type: ignore[attr-defined]
    except AttributeError:
            np_long = np.int_
            np_ulong = np.uint
else:
    np_long = np.int_
    np_ulong = np.uint

IntNumber = int | np.integer
DecimalNumber = float | np.floating | np.integer

copy_if_needed: bool | None

if np.lib.NumpyVersion(np.__version__) >= "2.0.0":
    copy_if_needed = None
elif np.lib.NumpyVersion(np.__version__) < "1.28.0":
    copy_if_needed = False
else:
    # 2.0.0 dev versions, handle cases where copy may or may not exist
    try:
        np.array([1]).__array__(copy=None)  # type: ignore[call-overload]
        copy_if_needed = None
    except TypeError:
        copy_if_needed = False


_RNG: TypeAlias = np.random.Generator | np.random.RandomState
SeedType: TypeAlias = IntNumber | _RNG | None

GeneratorType = TypeVar("GeneratorType", bound=_RNG)

# Since Generator was introduced in numpy 1.17, the following condition is needed for
# backward compatibility
try:
    from numpy.random import Generator as Generator
except ImportError:
    class Generator:  # type: ignore[no-redef]
        pass


def _lazyselect(condlist, choicelist, arrays, default=0):
    """
    Mimic `np.select(condlist, choicelist)`.

    Notice, it assumes that all `arrays` are of the same shape or can be
    broadcasted together.

    All functions in `choicelist` must accept array arguments in the order
    given in `arrays` and must return an array of the same shape as broadcasted
    `arrays`.

    Examples
    --------
    >>> import numpy as np
    >>> x = np.arange(6)
    >>> np.select([x <3, x > 3], [x**2, x**3], default=0)
    array([  0,   1,   4,   0,  64, 125])

    >>> _lazyselect([x < 3, x > 3], [lambda x: x**2, lambda x: x**3], (x,))
    array([   0.,    1.,    4.,   0.,   64.,  125.])

    >>> a = -np.ones_like(x)
    >>> _lazyselect([x < 3, x > 3],
    ...             [lambda x, a: x**2, lambda x, a: a * x**3],
    ...             (x, a), default=np.nan)
    array([   0.,    1.,    4.,   nan,  -64., -125.])

    """
    arrays = np.broadcast_arrays(*arrays)
    tcode = np.mintypecode([a.dtype.char for a in arrays])
    out = np.full(np.shape(arrays[0]), fill_value=default, dtype=tcode)
    for func, cond in zip(choicelist, condlist):
        if np.all(cond is False):
            continue
        cond, _ = np.broadcast_arrays(cond, arrays[0])
        temp = tuple(np.extract(cond, arr) for arr in arrays)
        np.place(out, cond, func(*temp))
    return out


def _aligned_zeros(shape, dtype=float, order="C", align=None):
    """Allocate a new ndarray with aligned memory.

    Primary use case for this currently is working around a f2py issue
    in NumPy 1.9.1, where dtype.alignment is such that np.zeros() does
    not necessarily create arrays aligned up to it.

    """
    dtype = np.dtype(dtype)
    if align is None:
        align = dtype.alignment
    if not hasattr(shape, '__len__'):
        shape = (shape,)
    size = functools.reduce(operator.mul, shape) * dtype.itemsize
    buf = np.empty(size + align + 1, np.uint8)
    offset = buf.__array_interface__['data'][0] % align
    if offset != 0:
        offset = align - offset
    # Note: slices producing 0-size arrays do not necessarily change
    # data pointer --- so we use and allocate size+1
    buf = buf[offset:offset+size+1][:-1]
    data = np.ndarray(shape, dtype, buf, order=order)
    data.fill(0)
    return data


def _prune_array(array):
    """Return an array equivalent to the input array. If the input
    array is a view of a much larger array, copy its contents to a
    newly allocated array. Otherwise, return the input unchanged.
    """
    if array.base is not None and array.size < array.base.size // 2:
        return array.copy()
    return array


def float_factorial(n: int) -> float:
    """Compute the factorial and return as a float

    Returns infinity when result is too large for a double
    """
    return float(math.factorial(n)) if n < 171 else np.inf


_rng_desc = (
    r"""If `rng` is passed by keyword, types other than `numpy.random.Generator` are
    passed to `numpy.random.default_rng` to instantiate a ``Generator``.
    If `rng` is already a ``Generator`` instance, then the provided instance is
    used. Specify `rng` for repeatable function behavior.

    If this argument is passed by position or `{old_name}` is passed by keyword,
    legacy behavior for the argument `{old_name}` applies:

    - If `{old_name}` is None (or `numpy.random`), the `numpy.random.RandomState`
      singleton is used.
    - If `{old_name}` is an int, a new ``RandomState`` instance is used,
      seeded with `{old_name}`.
    - If `{old_name}` is already a ``Generator`` or ``RandomState`` instance then
      that instance is used.

    .. versionchanged:: 1.15.0
        As part of the `SPEC-007 <https://scientific-python.org/specs/spec-0007/>`_
        transition from use of `numpy.random.RandomState` to
        `numpy.random.Generator`, this keyword was changed from `{old_name}` to `rng`.
        For an interim period, both keywords will continue to work, although only one
        may be specified at a time. After the interim period, function calls using the
        `{old_name}` keyword will emit warnings. The behavior of both `{old_name}` and
        `rng` are outlined above, but only the `rng` keyword should be used in new code.
        """
)


# SPEC 7
def _transition_to_rng(old_name, *, position_num=None, end_version=None,
                       replace_doc=True):
    """Example decorator to transition from old PRNG usage to new `rng` behavior

    Suppose the decorator is applied to a function that used to accept parameter
    `old_name='random_state'` either by keyword or as a positional argument at
    `position_num=1`. At the time of application, the name of the argument in the
    function signature is manually changed to the new name, `rng`. If positional
    use was allowed before, this is not changed.*

    - If the function is called with both `random_state` and `rng`, the decorator
      raises an error.
    - If `random_state` is provided as a keyword argument, the decorator passes
      `random_state` to the function's `rng` argument as a keyword. If `end_version`
      is specified, the decorator will emit a `DeprecationWarning` about the
      deprecation of keyword `random_state`.
    - If `random_state` is provided as a positional argument, the decorator passes
      `random_state` to the function's `rng` argument by position. If `end_version`
      is specified, the decorator will emit a `FutureWarning` about the changing
      interpretation of the argument.
    - If `rng` is provided as a keyword argument, the decorator validates `rng` using
      `numpy.random.default_rng` before passing it to the function.
    - If `end_version` is specified and neither `random_state` nor `rng` is provided
      by the user, the decorator checks whether `np.random.seed` has been used to set
      the global seed. If so, it emits a `FutureWarning`, noting that usage of
      `numpy.random.seed` will eventually have no effect. Either way, the decorator
      calls the function without explicitly passing the `rng` argument.

    If `end_version` is specified, a user must pass `rng` as a keyword to avoid
    warnings.

    After the deprecation period, the decorator can be removed, and the function
    can simply validate the `rng` argument by calling `np.random.default_rng(rng)`.

    * A `FutureWarning` is emitted when the PRNG argument is used by
      position. It indicates that the "Hinsen principle" (same
      code yielding different results in two versions of the software)
      will be violated, unless positional use is deprecated. Specifically:

      - If `None` is passed by position and `np.random.seed` has been used,
        the function will change from being seeded to being unseeded.
      - If an integer is passed by position, the random stream will change.
      - If `np.random` or an instance of `RandomState` is passed by position,
        an error will be raised.

      We suggest that projects consider deprecating positional use of
      `random_state`/`rng` (i.e., change their function signatures to
      ``def my_func(..., *, rng=None)``); that might not make sense
      for all projects, so this SPEC does not make that
      recommendation, neither does this decorator enforce it.

    Parameters
    ----------
    old_name : str
        The old name of the PRNG argument (e.g. `seed` or `random_state`).
    position_num : int, optional
        The (0-indexed) position of the old PRNG argument (if accepted by position).
        Maintainers are welcome to eliminate this argument and use, for example,
        `inspect`, if preferred.
    end_version : str, optional
        The full version number of the library when the behavior described in
        `DeprecationWarning`s and `FutureWarning`s will take effect. If left
        unspecified, no warnings will be emitted by the decorator.
    replace_doc : bool, default: True
        Whether the decorator should replace the documentation for parameter `rng` with
        `_rng_desc` (defined above), which documents both new `rng` keyword behavior
        and typical legacy `random_state`/`seed` behavior. If True, manually replace
        the first paragraph of the function's old `random_state`/`seed` documentation
        with the desired *final* `rng` documentation; this way, no changes to
        documentation are needed when the decorator is removed. Documentation of `rng`
        after the first blank line is preserved. Use False if the function's old
        `random_state`/`seed` behavior does not match that described by `_rng_desc`.

    """
    NEW_NAME = "rng"

    cmn_msg = (
        "To silence this warning and ensure consistent behavior in SciPy "
        f"{end_version}, control the RNG using argument `{NEW_NAME}`. Arguments passed "
        f"to keyword `{NEW_NAME}` will be validated by `np.random.default_rng`, so the "
        "behavior corresponding with a given value may change compared to use of "
        f"`{old_name}`. For example, "
        "1) `None` will result in unpredictable random numbers, "
        "2) an integer will result in a different stream of random numbers, (with the "
        "same distribution), and "
        "3) `np.random` or `RandomState` instances will result in an error. "
        "See the documentation of `default_rng` for more information."
    )

    def decorator(fun):
        @functools.wraps(fun)
        def wrapper(*args, **kwargs):
            # Determine how PRNG was passed
            as_old_kwarg = old_name in kwargs
            as_new_kwarg = NEW_NAME in kwargs
            as_pos_arg = position_num is not None and len(args) >= position_num + 1
            emit_warning = end_version is not None

            # Can only specify PRNG one of the three ways
            if int(as_old_kwarg) + int(as_new_kwarg) + int(as_pos_arg) > 1:
                message = (
                    f"{fun.__name__}() got multiple values for "
                    f"argument now known as `{NEW_NAME}`. Specify one of "
                    f"`{NEW_NAME}` or `{old_name}`."
                )
                raise TypeError(message)

            # Check whether global random state has been set
            global_seed_set = np.random.mtrand._rand._bit_generator._seed_seq is None

            if as_old_kwarg:  # warn about deprecated use of old kwarg
                kwargs[NEW_NAME] = kwargs.pop(old_name)
                if emit_warning:
                    message = (
                        f"Use of keyword argument `{old_name}` is "
                        f"deprecated and replaced by `{NEW_NAME}`.  "
                        f"Support for `{old_name}` will be removed "
                        f"in SciPy {end_version}. "
                    ) + cmn_msg
                    warnings.warn(message, DeprecationWarning, stacklevel=2)

            elif as_pos_arg:
                # Warn about changing meaning of positional arg

                # Note that this decorator does not deprecate positional use of the
                # argument; it only warns that the behavior will change in the future.
                # Simultaneously transitioning to keyword-only use is another option.

                arg = args[position_num]
                # If the argument is None and the global seed wasn't set, or if the
                # argument is one of a few new classes, the user will not notice change
                # in behavior.
                ok_classes = (
                    np.random.Generator,
                    np.random.SeedSequence,
                    np.random.BitGenerator,
                )
                if (arg is None and not global_seed_set) or isinstance(arg, ok_classes):
                    pass
                elif emit_warning:
                    message = (
                        f"Positional use of `{NEW_NAME}` (formerly known as "
                        f"`{old_name}`) is still allowed, but the behavior is "
                        "changing: the argument will be normalized using "
                        f"`np.random.default_rng` beginning in SciPy {end_version}, "
                        "and the resulting `Generator` will be used to generate "
                        "random numbers."
                    ) + cmn_msg
                    warnings.warn(message, FutureWarning, stacklevel=2)

            elif as_new_kwarg:  # no warnings; this is the preferred use
                # After the removal of the decorator, normalization with
                # np.random.default_rng will be done inside the decorated function
                kwargs[NEW_NAME] = np.random.default_rng(kwargs[NEW_NAME])

            elif global_seed_set and emit_warning:
                # Emit FutureWarning if `np.random.seed` was used and no PRNG was passed
                message = (
                    "The NumPy global RNG was seeded by calling "
                    f"`np.random.seed`. Beginning in {end_version}, this "
                    "function will no longer use the global RNG."
                ) + cmn_msg
                warnings.warn(message, FutureWarning, stacklevel=2)

            return fun(*args, **kwargs)

        if replace_doc:
            doc = FunctionDoc(wrapper)
            parameter_names = [param.name for param in doc['Parameters']]
            if 'rng' in parameter_names:
                _type = "{None, int, `numpy.random.Generator`}, optional"
                _desc = _rng_desc.replace("{old_name}", old_name)
                old_doc = doc['Parameters'][parameter_names.index('rng')].desc
                old_doc_keep = old_doc[old_doc.index("") + 1:] if "" in old_doc else []
                new_doc = [_desc] + old_doc_keep
                _rng_parameter_doc = Parameter('rng', _type, new_doc)
                doc['Parameters'][parameter_names.index('rng')] = _rng_parameter_doc
                doc = str(doc).split("\n", 1)[1]  # remove signature
                wrapper.__doc__ = str(doc)
        return wrapper

    return decorator


# copy-pasted from scikit-learn utils/validation.py
def check_random_state(seed):
    """Turn `seed` into a `np.random.RandomState` instance.

    Parameters
    ----------
    seed : {None, int, `numpy.random.Generator`, `numpy.random.RandomState`}, optional
        If `seed` is None (or `np.random`), the `numpy.random.RandomState`
        singleton is used.
        If `seed` is an int, a new ``RandomState`` instance is used,
        seeded with `seed`.
        If `seed` is already a ``Generator`` or ``RandomState`` instance then
        that instance is used.

    Returns
    -------
    seed : {`numpy.random.Generator`, `numpy.random.RandomState`}
        Random number generator.

    """
    if seed is None or seed is np.random:
        return np.random.mtrand._rand
    if isinstance(seed, numbers.Integral | np.integer):
        return np.random.RandomState(seed)
    if isinstance(seed, np.random.RandomState | np.random.Generator):
        return seed

    raise ValueError(f"'{seed}' cannot be used to seed a numpy.random.RandomState"
                     " instance")


def _asarray_validated(a, check_finite=True,
                       sparse_ok=False, objects_ok=False, mask_ok=False,
                       as_inexact=False):
    """
    Helper function for SciPy argument validation.

    Many SciPy linear algebra functions do support arbitrary array-like
    input arguments. Examples of commonly unsupported inputs include
    matrices containing inf/nan, sparse matrix representations, and
    matrices with complicated elements.

    Parameters
    ----------
    a : array_like
        The array-like input.
    check_finite : bool, optional
        Whether to check that the input matrices contain only finite numbers.
        Disabling may give a performance gain, but may result in problems
        (crashes, non-termination) if the inputs do contain infinities or NaNs.
        Default: True
    sparse_ok : bool, optional
        True if scipy sparse matrices are allowed.
    objects_ok : bool, optional
        True if arrays with dype('O') are allowed.
    mask_ok : bool, optional
        True if masked arrays are allowed.
    as_inexact : bool, optional
        True to convert the input array to a np.inexact dtype.

    Returns
    -------
    ret : ndarray
        The converted validated array.

    """
    if not sparse_ok:
        if issparse(a):
            msg = ('Sparse arrays/matrices are not supported by this function. '
                   'Perhaps one of the `scipy.sparse.linalg` functions '
                   'would work instead.')
            raise ValueError(msg)
    if not mask_ok:
        if np.ma.isMaskedArray(a):
            raise ValueError('masked arrays are not supported')
    toarray = np.asarray_chkfinite if check_finite else np.asarray
    a = toarray(a)
    if not objects_ok:
        if a.dtype is np.dtype('O'):
            raise ValueError('object arrays are not supported')
    if as_inexact:
        if not np.issubdtype(a.dtype, np.inexact):
            a = toarray(a, dtype=np.float64)
    return a


def _validate_int(k, name, minimum=None):
    """
    Validate a scalar integer.

    This function can be used to validate an argument to a function
    that expects the value to be an integer.  It uses `operator.index`
    to validate the value (so, for example, k=2.0 results in a
    TypeError).

    Parameters
    ----------
    k : int
        The value to be validated.
    name : str
        The name of the parameter.
    minimum : int, optional
        An optional lower bound.
    """
    try:
        k = operator.index(k)
    except TypeError:
        raise TypeError(f'{name} must be an integer.') from None
    if minimum is not None and k < minimum:
        raise ValueError(f'{name} must be an integer not less '
                         f'than {minimum}') from None
    return k


# Add a replacement for inspect.getfullargspec()/
# The version below is borrowed from Django,
# https://github.com/django/django/pull/4846.

# Note an inconsistency between inspect.getfullargspec(func) and
# inspect.signature(func). If `func` is a bound method, the latter does *not*
# list `self` as a first argument, while the former *does*.
# Hence, cook up a common ground replacement: `getfullargspec_no_self` which
# mimics `inspect.getfullargspec` but does not list `self`.
#
# This way, the caller code does not need to know whether it uses a legacy
# .getfullargspec or a bright and shiny .signature.

FullArgSpec = namedtuple('FullArgSpec',
                         ['args', 'varargs', 'varkw', 'defaults',
                          'kwonlyargs', 'kwonlydefaults', 'annotations'])


def getfullargspec_no_self(func):
    """inspect.getfullargspec replacement using inspect.signature.

    If func is a bound method, do not list the 'self' parameter.

    Parameters
    ----------
    func : callable
        A callable to inspect

    Returns
    -------
    fullargspec : FullArgSpec(args, varargs, varkw, defaults, kwonlyargs,
                              kwonlydefaults, annotations)

        NOTE: if the first argument of `func` is self, it is *not*, I repeat
        *not*, included in fullargspec.args.
        This is done for consistency between inspect.getargspec() under
        Python 2.x, and inspect.signature() under Python 3.x.

    """
    sig = inspect.signature(func)
    args = [
        p.name for p in sig.parameters.values()
        if p.kind in [inspect.Parameter.POSITIONAL_OR_KEYWORD,
                      inspect.Parameter.POSITIONAL_ONLY]
    ]
    varargs = [
        p.name for p in sig.parameters.values()
        if p.kind == inspect.Parameter.VAR_POSITIONAL
    ]
    varargs = varargs[0] if varargs else None
    varkw = [
        p.name for p in sig.parameters.values()
        if p.kind == inspect.Parameter.VAR_KEYWORD
    ]
    varkw = varkw[0] if varkw else None
    defaults = tuple(
        p.default for p in sig.parameters.values()
        if (p.kind == inspect.Parameter.POSITIONAL_OR_KEYWORD and
            p.default is not p.empty)
    ) or None
    kwonlyargs = [
        p.name for p in sig.parameters.values()
        if p.kind == inspect.Parameter.KEYWORD_ONLY
    ]
    kwdefaults = {p.name: p.default for p in sig.parameters.values()
                  if p.kind == inspect.Parameter.KEYWORD_ONLY and
                  p.default is not p.empty}
    annotations = {p.name: p.annotation for p in sig.parameters.values()
                   if p.annotation is not p.empty}
    return FullArgSpec(args, varargs, varkw, defaults, kwonlyargs,
                       kwdefaults or None, annotations)


class _FunctionWrapper:
    """
    Object to wrap user's function, allowing picklability
    """
    def __init__(self, f, args):
        self.f = f
        self.args = [] if args is None else args

    def __call__(self, x):
        return self.f(x, *self.args)


class _ScalarFunctionWrapper:
    """
    Object to wrap scalar user function, allowing picklability
    """
    def __init__(self, f, args=None):
        self.f = f
        self.args = [] if args is None else args
        self.nfev = 0

    def __call__(self, x):
        # Send a copy because the user may overwrite it.
        # The user of this class might want `x` to remain unchanged.
        fx = self.f(np.copy(x), *self.args)
        self.nfev += 1

        # Make sure the function returns a true scalar
        if not np.isscalar(fx):
            try:
                fx = np.asarray(fx).item()
            except (TypeError, ValueError) as e:
                raise ValueError(
                    "The user-provided objective function "
                    "must return a scalar value."
                ) from e
        return fx

class MapWrapper:
    """
    Parallelisation wrapper for working with map-like callables, such as
    `multiprocessing.Pool.map`.

    Parameters
    ----------
    pool : int or map-like callable
        If `pool` is an integer, then it specifies the number of threads to
        use for parallelization. If ``int(pool) == 1``, then no parallel
        processing is used and the map builtin is used.
        If ``pool == -1``, then the pool will utilize all available CPUs.
        If `pool` is a map-like callable that follows the same
        calling sequence as the built-in map function, then this callable is
        used for parallelization.
    """
    def __init__(self, pool=1):
        self.pool = None
        self._mapfunc = map
        self._own_pool = False

        if callable(pool):
            self.pool = pool
            self._mapfunc = self.pool
        else:
            from multiprocessing import Pool
            # user supplies a number
            if int(pool) == -1:
                # use as many processors as possible
                self.pool = Pool()
                self._mapfunc = self.pool.map
                self._own_pool = True
            elif int(pool) == 1:
                pass
            elif int(pool) > 1:
                # use the number of processors requested
                self.pool = Pool(processes=int(pool))
                self._mapfunc = self.pool.map
                self._own_pool = True
            else:
                raise RuntimeError("Number of workers specified must be -1,"
                                   " an int >= 1, or an object with a 'map' "
                                   "method")

    def __enter__(self):
        return self

    def terminate(self):
        if self._own_pool:
            self.pool.terminate()

    def join(self):
        if self._own_pool:
            self.pool.join()

    def close(self):
        if self._own_pool:
            self.pool.close()

    def __exit__(self, exc_type, exc_value, traceback):
        if self._own_pool:
            self.pool.close()
            self.pool.terminate()

    def __call__(self, func, iterable):
        # only accept one iterable because that's all Pool.map accepts
        try:
            return self._mapfunc(func, iterable)
        except TypeError as e:
            # wrong number of arguments
            raise TypeError("The map-like callable must be of the"
                            " form f(func, iterable)") from e


def _workers_wrapper(func):
    """
    Wrapper to deal with setup-cleanup of workers outside a user function via a
    ContextManager. It saves having to do the setup/tear down with within that
    function, which can be messy.
    """
    @functools.wraps(func)
    def inner(*args, **kwds):
        kwargs = kwds.copy()
        if 'workers' not in kwargs:
            _workers = map
        elif 'workers' in kwargs and kwargs['workers'] is None:
            _workers = map
        else:
            _workers = kwargs['workers']

        with MapWrapper(_workers) as mf:
            kwargs['workers'] = mf
            return func(*args, **kwargs)

    return inner


def rng_integers(gen, low, high=None, size=None, dtype='int64',
                 endpoint=False):
    """
    Return random integers from low (inclusive) to high (exclusive), or if
    endpoint=True, low (inclusive) to high (inclusive). Replaces
    `RandomState.randint` (with endpoint=False) and
    `RandomState.random_integers` (with endpoint=True).

    Return random integers from the "discrete uniform" distribution of the
    specified dtype. If high is None (the default), then results are from
    0 to low.

    Parameters
    ----------
    gen : {None, np.random.RandomState, np.random.Generator}
        Random number generator. If None, then the np.random.RandomState
        singleton is used.
    low : int or array-like of ints
        Lowest (signed) integers to be drawn from the distribution (unless
        high=None, in which case this parameter is 0 and this value is used
        for high).
    high : int or array-like of ints
        If provided, one above the largest (signed) integer to be drawn from
        the distribution (see above for behavior if high=None). If array-like,
        must contain integer values.
    size : array-like of ints, optional
        Output shape. If the given shape is, e.g., (m, n, k), then m * n * k
        samples are drawn. Default is None, in which case a single value is
        returned.
    dtype : {str, dtype}, optional
        Desired dtype of the result. All dtypes are determined by their name,
        i.e., 'int64', 'int', etc, so byteorder is not available and a specific
        precision may have different C types depending on the platform.
        The default value is 'int64'.
    endpoint : bool, optional
        If True, sample from the interval [low, high] instead of the default
        [low, high) Defaults to False.

    Returns
    -------
    out: int or ndarray of ints
        size-shaped array of random integers from the appropriate distribution,
        or a single such random int if size not provided.
    """
    if isinstance(gen, Generator):
        return gen.integers(low, high=high, size=size, dtype=dtype,
                            endpoint=endpoint)
    else:
        if gen is None:
            # default is RandomState singleton used by np.random.
            gen = np.random.mtrand._rand
        if endpoint:
            # inclusive of endpoint
            # remember that low and high can be arrays, so don't modify in
            # place
            if high is None:
                return gen.randint(low + 1, size=size, dtype=dtype)
            if high is not None:
                return gen.randint(low, high=high + 1, size=size, dtype=dtype)

        # exclusive
        return gen.randint(low, high=high, size=size, dtype=dtype)


@contextmanager
def _fixed_default_rng(seed=1638083107694713882823079058616272161):
    """Context with a fixed np.random.default_rng seed."""
    orig_fun = np.random.default_rng
    np.random.default_rng = lambda seed=seed: orig_fun(seed)
    try:
        yield
    finally:
        np.random.default_rng = orig_fun


def _rng_html_rewrite(func):
    """Rewrite the HTML rendering of ``np.random.default_rng``.

    This is intended to decorate
    ``numpydoc.docscrape_sphinx.SphinxDocString._str_examples``.

    Examples are only run by Sphinx when there are plot involved. Even so,
    it does not change the result values getting printed.
    """
    # hexadecimal or number seed, case-insensitive
    pattern = re.compile(r'np.random.default_rng\((0x[0-9A-F]+|\d+)\)', re.I)

    def _wrapped(*args, **kwargs):
        res = func(*args, **kwargs)
        lines = [
            re.sub(pattern, 'np.random.default_rng()', line)
            for line in res
        ]
        return lines

    return _wrapped


def _argmin(a, keepdims=False, axis=None):
    """
    argmin with a `keepdims` parameter.

    See https://github.com/numpy/numpy/issues/8710

    If axis is not None, a.shape[axis] must be greater than 0.
    """
    res = np.argmin(a, axis=axis)
    if keepdims and axis is not None:
        res = np.expand_dims(res, axis=axis)
    return res


def _first_nonnan(a, axis):
    """
    Return the first non-nan value along the given axis.

    If a slice is all nan, nan is returned for that slice.

    The shape of the return value corresponds to ``keepdims=True``.

    Examples
    --------
    >>> import numpy as np
    >>> nan = np.nan
    >>> a = np.array([[ 3.,  3., nan,  3.],
                      [ 1., nan,  2.,  4.],
                      [nan, nan,  9., -1.],
                      [nan,  5.,  4.,  3.],
                      [ 2.,  2.,  2.,  2.],
                      [nan, nan, nan, nan]])
    >>> _first_nonnan(a, axis=0)
    array([[3., 3., 2., 3.]])
    >>> _first_nonnan(a, axis=1)
    array([[ 3.],
           [ 1.],
           [ 9.],
           [ 5.],
           [ 2.],
           [nan]])
    """
    k = _argmin(np.isnan(a), axis=axis, keepdims=True)
    return np.take_along_axis(a, k, axis=axis)


def _nan_allsame(a, axis, keepdims=False):
    """
    Determine if the values along an axis are all the same.

    nan values are ignored.

    `a` must be a numpy array.

    `axis` is assumed to be normalized; that is, 0 <= axis < a.ndim.

    For an axis of length 0, the result is True.  That is, we adopt the
    convention that ``allsame([])`` is True. (There are no values in the
    input that are different.)

    `True` is returned for slices that are all nan--not because all the
    values are the same, but because this is equivalent to ``allsame([])``.

    Examples
    --------
    >>> from numpy import nan, array
    >>> a = array([[ 3.,  3., nan,  3.],
    ...            [ 1., nan,  2.,  4.],
    ...            [nan, nan,  9., -1.],
    ...            [nan,  5.,  4.,  3.],
    ...            [ 2.,  2.,  2.,  2.],
    ...            [nan, nan, nan, nan]])
    >>> _nan_allsame(a, axis=1, keepdims=True)
    array([[ True],
           [False],
           [False],
           [False],
           [ True],
           [ True]])
    """
    if axis is None:
        if a.size == 0:
            return True
        a = a.ravel()
        axis = 0
    else:
        shp = a.shape
        if shp[axis] == 0:
            shp = shp[:axis] + (1,)*keepdims + shp[axis + 1:]
            return np.full(shp, fill_value=True, dtype=bool)
    a0 = _first_nonnan(a, axis=axis)
    return ((a0 == a) | np.isnan(a)).all(axis=axis, keepdims=keepdims)


def _contains_nan(
    a: Array,
    nan_policy: Literal["propagate", "raise", "omit"] = "propagate",
    *,
    xp_omit_okay: bool = False, 
    xp: ModuleType | None = None,
) -> Array | bool:
    # Regarding `xp_omit_okay`: Temporarily, while `_axis_nan_policy` does not
    # handle non-NumPy arrays, most functions that call `_contains_nan` want
    # it to raise an error if `nan_policy='omit'` and `xp` is not `np`.
    # Some functions support `nan_policy='omit'` natively, so setting this to
    # `True` prevents the error from being raised.
    policies = {"propagate", "raise", "omit"}
    if nan_policy not in policies:
        msg = f"nan_policy must be one of {policies}."
        raise ValueError(msg)

    if xp_size(a) == 0:
        return False

    if xp is None:
        xp = array_namespace(a)

    if xp.isdtype(a.dtype, "real floating"):
        # Faster and less memory-intensive than xp.any(xp.isnan(a)), and unlike other
        # reductions, `max`/`min` won't return NaN unless there is a NaN in the data.
        contains_nan = xp.isnan(xp.max(a))
    elif xp.isdtype(a.dtype, "complex floating"):
        # Typically `real` and `imag` produce views; otherwise, `xp.any(xp.isnan(a))`
        # would be more efficient.
        contains_nan = xp.isnan(xp.max(xp.real(a))) | xp.isnan(xp.max(xp.imag(a)))
    elif is_numpy(xp) and np.issubdtype(a.dtype, object):
        contains_nan = False
        for el in a.ravel():
            # isnan doesn't work on non-numeric elements
            if np.issubdtype(type(el), np.number) and np.isnan(el):
                contains_nan = True
                break
    else:
        # Only `object` and `inexact` arrays can have NaNs
        return False

    # The implicit call to bool(contains_nan) must happen after testing
    # nan_policy to prevent lazy and device-bound xps from raising in the
    # default policy='propagate' case.
    if nan_policy == 'raise':
        if is_lazy_array(a):
            msg = "nan_policy='raise' is not supported for lazy arrays."
            raise TypeError(msg)
        if contains_nan:
            msg = "The input contains nan values"
            raise ValueError(msg)
    elif nan_policy == 'omit' and not xp_omit_okay and not is_numpy(xp):
        if is_lazy_array(a):
            msg = "nan_policy='omit' is not supported for lazy arrays."
            raise TypeError(msg)
        if contains_nan:
            msg = "nan_policy='omit' is incompatible with non-NumPy arrays."
            raise ValueError(msg)

    return contains_nan


def _rename_parameter(old_name, new_name, dep_version=None):
    """
    Generate decorator for backward-compatible keyword renaming.

    Apply the decorator generated by `_rename_parameter` to functions with a
    recently renamed parameter to maintain backward-compatibility.

    After decoration, the function behaves as follows:
    If only the new parameter is passed into the function, behave as usual.
    If only the old parameter is passed into the function (as a keyword), raise
    a DeprecationWarning if `dep_version` is provided, and behave as usual
    otherwise.
    If both old and new parameters are passed into the function, raise a
    DeprecationWarning if `dep_version` is provided, and raise the appropriate
    TypeError (function got multiple values for argument).

    Parameters
    ----------
    old_name : str
        Old name of parameter
    new_name : str
        New name of parameter
    dep_version : str, optional
        Version of SciPy in which old parameter was deprecated in the format
        'X.Y.Z'. If supplied, the deprecation message will indicate that
        support for the old parameter will be removed in version 'X.Y+2.Z'

    Notes
    -----
    Untested with functions that accept *args. Probably won't work as written.

    """
    def decorator(fun):
        @functools.wraps(fun)
        def wrapper(*args, **kwargs):
            if old_name in kwargs:
                if dep_version:
                    end_version = dep_version.split('.')
                    end_version[1] = str(int(end_version[1]) + 2)
                    end_version = '.'.join(end_version)
                    message = (f"Use of keyword argument `{old_name}` is "
                               f"deprecated and replaced by `{new_name}`.  "
                               f"Support for `{old_name}` will be removed "
                               f"in SciPy {end_version}.")
                    warnings.warn(message, DeprecationWarning, stacklevel=2)
                if new_name in kwargs:
                    message = (f"{fun.__name__}() got multiple values for "
                               f"argument now known as `{new_name}`")
                    raise TypeError(message)
                kwargs[new_name] = kwargs.pop(old_name)
            return fun(*args, **kwargs)
        return wrapper
    return decorator


def _rng_spawn(rng, n_children):
    # spawns independent RNGs from a parent RNG
    bg = rng._bit_generator
    ss = bg._seed_seq
    child_rngs = [np.random.Generator(type(bg)(child_ss))
                  for child_ss in ss.spawn(n_children)]
    return child_rngs


def _get_nan(*data, shape=(), xp=None):
    xp = array_namespace(*data) if xp is None else xp
    # Get NaN of appropriate dtype for data
    dtype = xp_result_type(*data, force_floating=True, xp=xp)
    device = xp_result_device(*data)
    res = xp.full(shape, xp.nan, dtype=dtype, device=device)
    if not shape:
        res = res[()]
    # whenever mdhaber/marray#89 is resolved, could just return `res`
    return res.data if is_marray(xp) else res


def normalize_axis_index(axis, ndim):
    # Check if `axis` is in the correct range and normalize it
    if axis < -ndim or axis >= ndim:
        msg = f"axis {axis} is out of bounds for array of dimension {ndim}"
        raise AxisError(msg)

    if axis < 0:
        axis = axis + ndim
    return axis


def _call_callback_maybe_halt(callback, res):
    """Call wrapped callback; return True if algorithm should stop.

    Parameters
    ----------
    callback : callable or None
        A user-provided callback wrapped with `_wrap_callback`
    res : OptimizeResult
        Information about the current iterate

    Returns
    -------
    halt : bool
        True if minimization should stop

    """
    if callback is None:
        return False
    try:
        callback(res)
        return False
    except StopIteration:
        callback.stop_iteration = True
        return True


class _RichResult(dict):
    """ Container for multiple outputs with pretty-printing """
    def __getattr__(self, name):
        try:
            return self[name]
        except KeyError as e:
            raise AttributeError(name) from e

    __setattr__ = dict.__setitem__  # type: ignore[assignment]
    __delattr__ = dict.__delitem__  # type: ignore[assignment]

    def __repr__(self):
        order_keys = ['message', 'success', 'status', 'fun', 'funl', 'x', 'xl',
                      'col_ind', 'nit', 'lower', 'upper', 'eqlin', 'ineqlin',
                      'converged', 'flag', 'function_calls', 'iterations',
                      'root']
        order_keys = getattr(self, '_order_keys', order_keys)
        # 'slack', 'con' are redundant with residuals
        # 'crossover_nit' is probably not interesting to most users
        omit_keys = {'slack', 'con', 'crossover_nit', '_order_keys'}

        def key(item):
            try:
                return order_keys.index(item[0].lower())
            except ValueError:  # item not in list
                return np.inf

        def omit_redundant(items):
            for item in items:
                if item[0] in omit_keys:
                    continue
                yield item

        def item_sorter(d):
            return sorted(omit_redundant(d.items()), key=key)

        if self.keys():
            return _dict_formatter(self, sorter=item_sorter)
        else:
            return self.__class__.__name__ + "()"

    def __dir__(self):
        return list(self.keys())


def _indenter(s, n=0):
    """
    Ensures that lines after the first are indented by the specified amount
    """
    split = s.split("\n")
    indent = " "*n
    return ("\n" + indent).join(split)


def _float_formatter_10(x):
    """
    Returns a string representation of a float with exactly ten characters
    """
    if np.isposinf(x):
        return "       inf"
    elif np.isneginf(x):
        return "      -inf"
    elif np.isnan(x):
        return "       nan"
    return np.format_float_scientific(x, precision=3, pad_left=2, unique=False)


def _dict_formatter(d, n=0, mplus=1, sorter=None):
    """
    Pretty printer for dictionaries

    `n` keeps track of the starting indentation;
    lines are indented by this much after a line break.
    `mplus` is additional left padding applied to keys
    """
    if isinstance(d, dict):
        m = max(map(len, list(d.keys()))) + mplus  # width to print keys
        s = '\n'.join([k.rjust(m) + ': ' +  # right justified, width m
                       _indenter(_dict_formatter(v, m+n+2, 0, sorter), m+2)
                       for k, v in sorter(d)])  # +2 for ': '
    else:
        # By default, NumPy arrays print with linewidth=76. `n` is
        # the indent at which a line begins printing, so it is subtracted
        # from the default to avoid exceeding 76 characters total.
        # `edgeitems` is the number of elements to include before and after
        # ellipses when arrays are not shown in full.
        # `threshold` is the maximum number of elements for which an
        # array is shown in full.
        # These values tend to work well for use with OptimizeResult.
        with np.printoptions(linewidth=76-n, edgeitems=2, threshold=12,
                             formatter={'float_kind': _float_formatter_10}):
            s = str(d)
    return s


_batch_note = """
The documentation is written assuming array arguments are of specified
"core" shapes. However, array argument(s) of this function may have additional
"batch" dimensions prepended to the core shape. In this case, the array is treated
as a batch of lower-dimensional slices; see :ref:`linalg_batch` for details.
"""


def _apply_over_batch(*argdefs):
    """
    Factory for decorator that applies a function over batched arguments.

    Array arguments may have any number of core dimensions (typically 0,
    1, or 2) and any broadcastable batch shapes. There may be any
    number of array outputs of any number of dimensions. Assumptions
    right now - which are satisfied by all functions of interest in `linalg` -
    are that all array inputs are consecutive keyword or positional arguments,
    and that the wrapped function returns either a single array or a tuple of
    arrays. It's only as general as it needs to be right now - it can be extended.

    Parameters
    ----------
    *argdefs : tuple of (str, int)
        Definitions of array arguments: the keyword name of the argument, and
        the number of core dimensions.

    Example:
    --------
    `linalg.eig` accepts two matrices as the first two arguments `a` and `b`, where
    `b` is optional, and returns one array or a tuple of arrays, depending on the
    values of other positional or keyword arguments. To generate a wrapper that applies
    the function over batches of `a` and optionally `b` :

    >>> _apply_over_batch(('a', 2), ('b', 2))
    """
    names, ndims = list(zip(*argdefs))
    n_arrays = len(names)

    def decorator(f):
        @functools.wraps(f)
        def wrapper(*args, **kwargs):
            args = list(args)

            # Ensure all arrays in `arrays`, other arguments in `other_args`/`kwargs`
            arrays, other_args = args[:n_arrays], args[n_arrays:]
            for i, name in enumerate(names):
                if name in kwargs:
                    if i + 1 <= len(args):
                        raise ValueError(f'{f.__name__}() got multiple values '
                                         f'for argument `{name}`.')
                    else:
                        arrays.append(kwargs.pop(name))

            # Determine core and batch shapes
            batch_shapes = []
            core_shapes = []
            for i, (array, ndim) in enumerate(zip(arrays, ndims)):
                array = None if array is None else np.asarray(array)
                shape = () if array is None else array.shape

                if ndim == "1|2":  # special case for `solve`, etc.
                    ndim = 2 if array.ndim >= 2 else 1

                arrays[i] = array
                batch_shapes.append(shape[:-ndim] if ndim > 0 else shape)
                core_shapes.append(shape[-ndim:] if ndim > 0 else ())

            # Early exit if call is not batched
            if not any(batch_shapes):
                return f(*arrays, *other_args, **kwargs)

            # Determine broadcasted batch shape
            batch_shape = np.broadcast_shapes(*batch_shapes)  # Gives OK error message

            # Broadcast arrays to appropriate shape
            for i, (array, core_shape) in enumerate(zip(arrays, core_shapes)):
                if array is None:
                    continue
                arrays[i] = np.broadcast_to(array, batch_shape + core_shape)

            # Main loop
            results = []
            for index in np.ndindex(batch_shape):
                result = f(*(array[index] for array in arrays), *other_args, **kwargs)
                # Assume `result` is either a tuple or single array. This is easily
                # generalized by allowing the contributor to pass an `unpack_result`
                # callable to the decorator factory.
                result = (result,) if not isinstance(result, tuple) else result
                results.append(result)
            results = list(zip(*results))

            # Reshape results
            for i, result in enumerate(results):
                result = np.stack(result)
                core_shape = result.shape[1:]
                results[i] = np.reshape(result, batch_shape + core_shape)

            # Assume `result` should be a single array if there is only one element or
            # a `tuple` otherwise. This is easily generalized by allowing the
            # contributor to pass an `pack_result` callable to the decorator factory.
            return results[0] if len(results) == 1 else results

        doc = FunctionDoc(wrapper)
        doc['Extended Summary'].append(_batch_note.rstrip())
        wrapper.__doc__ = str(doc).split("\n", 1)[1]  # remove signature

        return wrapper
    return decorator


def np_vecdot(x1, x2, /, *, axis=-1):
    # `np.vecdot` has advantages (e.g. see gh-22462), so let's use it when
    # available. As functions are translated to Array API, `np_vecdot` can be
    # replaced with `xp.vecdot`.
    if np.__version__ > "2.0":
        return np.vecdot(x1, x2, axis=axis)
    else:
        # of course there are other fancy ways of doing this (e.g. `einsum`)
        # but let's keep it simple since it's temporary
        return np.sum(x1 * x2, axis=axis)
