from functools import partial
import pickle

import pytest
from hypothesis import given, strategies
import hypothesis.extra.numpy as npst
from packaging import version

from scipy import special
from scipy.special._support_alternative_backends import _special_funcs
from scipy._lib._array_api_no_0d import xp_assert_close
from scipy._lib._array_api import (is_cupy, is_dask, is_jax, is_torch,
                                   make_xp_pytest_param, make_xp_test_case,
                                   xp_default_dtype)
from scipy._lib.array_api_compat import numpy as np

# Run all tests in this module in the Array API CI, including those without
# the xp fixture
pytestmark = pytest.mark.array_api_backends

lazy_xp_modules = [special]


def _skip_or_tweak_alternative_backends(xp, f_name, dtypes):
    """Skip tests for specific intersections of scipy.special functions 
    vs. backends vs. dtypes vs. devices.
    Also suggest bespoke tweaks.

    Returns
    -------
    positive_only : bool
        Whether you should exclusively test positive inputs.
    dtypes_np_ref : list[str]
        The dtypes to use for the reference NumPy arrays.
    """
    if ((is_jax(xp) and f_name == 'gammaincc')  # google/jax#20699
        # gh-20972
        or ((is_cupy(xp) or is_jax(xp) or is_torch(xp)) and f_name == 'chdtrc')):
        positive_only = True
    else:
        positive_only = False

    if not any('int' in dtype for dtype in dtypes):
        return positive_only, dtypes

    # Integer-specific issues from this point onwards

    if ((is_torch(xp) and f_name in {'gammainc', 'gammaincc'})
        or (is_cupy(xp) and f_name in {'stdtr', 'i0e', 'i1e'})
        or (is_jax(xp) and f_name in {'stdtr', 'ndtr', 'ndtri', 'log_ndtr'})
    ):
        pytest.skip(f"`{f_name}` does not support integer types")

    # int/float mismatched args support is sketchy
    if (any('float' in dtype for dtype in dtypes)
        and ((is_torch(xp) and f_name in ('rel_entr', 'xlogy'))
             or (is_jax(xp) and f_name in ('gammainc', 'gammaincc',
                                           'rel_entr', 'xlogy')))
    ):
        pytest.xfail("dtypes do not match")

    dtypes_np_ref = dtypes
    if (is_torch(xp) and xp_default_dtype(xp) == xp.float32
        and f_name not in {'betainc', 'betaincc', 'stdtr', 'stdtrit'}
    ):
        # On PyTorch with float32 default dtype, sometimes ints are promoted
        # to float32, and sometimes to float64.
        # When they are promoted to float32, explicitly convert the reference
        # numpy arrays to float32 to prevent them from being automatically promoted
        # to float64 instead.
        dtypes_np_ref = ['float32' if 'int' in dtype else dtype for dtype in dtypes]

    return positive_only, dtypes_np_ref


@pytest.mark.filterwarnings("ignore:invalid value encountered:RuntimeWarning:dask")
@pytest.mark.parametrize('shapes', [[(0,)]*4, [tuple()]*4, [(10,)]*4,
                                    [(10,), (11, 1), (12, 1, 1), (13, 1, 1, 1)]])
@pytest.mark.parametrize('dtype', ['float32', 'float64', 'int64'])
@pytest.mark.parametrize(
    'func,nfo', [make_xp_pytest_param(i.wrapper, i) for i in _special_funcs])
def test_support_alternative_backends(xp, func, nfo, dtype, shapes):
    positive_only, [dtype_np_ref] = _skip_or_tweak_alternative_backends(
        xp, nfo.name, [dtype])
    dtype_np = getattr(np, dtype)
    dtype_xp = getattr(xp, dtype)

    shapes = shapes[:nfo.n_args]
    rng = np.random.default_rng(984254252920492019)
    if 'int' in dtype:
        iinfo = np.iinfo(dtype_np)
        rand = partial(rng.integers, iinfo.min, iinfo.max + 1)
    else:
        rand = rng.standard_normal
    args_np = [rand(size=shape, dtype=dtype_np) for shape in shapes]
    if positive_only:
        args_np = [np.abs(arg) for arg in args_np]

    args_xp = [xp.asarray(arg, dtype=dtype_xp) for arg in args_np]
    args_np = [np.asarray(arg, dtype=dtype_np_ref) for arg in args_np]

    if is_dask(xp):
        # We're using map_blocks to dispatch the function to Dask.
        # This is the correct thing to do IF all tested functions are elementwise;
        # otherwise the output would change depending on chunking.
        # Try to trigger bugs related to having multiple chunks.
        args_xp = [arg.rechunk(5) for arg in args_xp]

    res = nfo.wrapper(*args_xp)  # Also wrapped by lazy_xp_function
    ref = nfo.func(*args_np)  # Unwrapped ufunc

    # When dtype_np is integer, the output dtype can be float
    atol = 0 if ref.dtype.kind in 'iu' else 10 * np.finfo(ref.dtype).eps
    xp_assert_close(res, xp.asarray(ref), atol=atol)


@pytest.mark.parametrize(
    'func, nfo',
    [make_xp_pytest_param(i.wrapper, i) for i in _special_funcs if i.n_args >= 2])
@pytest.mark.filterwarnings("ignore:invalid value encountered:RuntimeWarning:dask")
def test_support_alternative_backends_mismatched_dtypes(xp, func, nfo):
    """Test mix-n-match of int and float arguments"""
    dtypes = ['int64', 'float32', 'float64'][:nfo.n_args]
    dtypes_xp = [xp.int64, xp.float32, xp.float64][:nfo.n_args]
    positive_only, dtypes_np_ref = _skip_or_tweak_alternative_backends(
        xp, nfo.name, dtypes)

    rng = np.random.default_rng(984254252920492019)
    iinfo = np.iinfo(np.int64)
    randint = partial(rng.integers, iinfo.min, iinfo.max + 1)
    args_np = [
        randint(size=1, dtype=np.int64),
        rng.standard_normal(size=1, dtype=np.float32),
        rng.standard_normal(size=1, dtype=np.float64),
    ][:nfo.n_args]
    if positive_only:
        args_np = [np.abs(arg) for arg in args_np]

    args_xp = [xp.asarray(arg, dtype=dtype_xp)
               for arg, dtype_xp in zip(args_np, dtypes_xp)]
    args_np = [np.asarray(arg, dtype=dtype_np_ref)
               for arg, dtype_np_ref in zip(args_np, dtypes_np_ref)]

    res = nfo.wrapper(*args_xp)  # Also wrapped by lazy_xp_function
    ref = nfo.func(*args_np)  # Unwrapped ufunc

    atol = 10 * np.finfo(ref.dtype).eps
    xp_assert_close(res, xp.asarray(ref), atol=atol)


@pytest.mark.xslow
@given(data=strategies.data())
@pytest.mark.fail_slow(5)
@pytest.mark.parametrize(
    'func,nfo', [make_xp_pytest_param(nfo.wrapper, nfo) for nfo in _special_funcs])
@pytest.mark.filterwarnings("ignore:invalid value encountered:RuntimeWarning:dask")
@pytest.mark.filterwarnings("ignore:divide by zero encountered:RuntimeWarning:dask")
@pytest.mark.filterwarnings("ignore:overflow encountered:RuntimeWarning:dask")
@pytest.mark.filterwarnings(
    "ignore:overflow encountered:RuntimeWarning:array_api_strict"
)
def test_support_alternative_backends_hypothesis(xp, func, nfo, data):
    dtype = data.draw(strategies.sampled_from(['float32', 'float64', 'int64']))
    positive_only, [dtype_np_ref] = _skip_or_tweak_alternative_backends(
        xp, nfo.name, [dtype])
    dtype_np = getattr(np, dtype)
    dtype_xp = getattr(xp, dtype)

    elements = {'allow_subnormal': False}
    # Most failures are due to NaN or infinity; uncomment to suppress them
    # elements['allow_infinity'] = False
    # elements['allow_nan'] = False
    if positive_only:
        elements['min_value'] = 0

    shapes, _ = data.draw(
        npst.mutually_broadcastable_shapes(num_shapes=nfo.n_args))
    args_np = [data.draw(npst.arrays(dtype_np, shape, elements=elements))
               for shape in shapes]

    args_xp = [xp.asarray(arg, dtype=dtype_xp) for arg in args_np]
    args_np = [np.asarray(arg, dtype=dtype_np_ref) for arg in args_np]

    res = nfo.wrapper(*args_xp)  # Also wrapped by lazy_xp_function
    ref = nfo.func(*args_np)  # Unwrapped ufunc

    # When dtype_np is integer, the output dtype can be float
    atol = 0 if ref.dtype.kind in 'iu' else 10 * np.finfo(ref.dtype).eps
    xp_assert_close(res, xp.asarray(ref), atol=atol)


@pytest.mark.parametrize("func", [nfo.wrapper for nfo in _special_funcs])
def test_pickle(func):
    roundtrip = pickle.loads(pickle.dumps(func))
    assert roundtrip is func


@pytest.mark.parametrize("func", [nfo.wrapper for nfo in _special_funcs])
def test_repr(func):
    assert func.__name__ in repr(func)
    assert "locals" not in repr(func)


@pytest.mark.skipif(
    version.parse(np.__version__) < version.parse("2.2"),
    reason="Can't update ufunc __doc__ when SciPy is compiled vs. NumPy < 2.2")
@pytest.mark.parametrize('func', [nfo.wrapper for nfo in _special_funcs])
def test_doc(func):
    """xp_capabilities updates the docstring in place. 
    Make sure it does so exactly once, including when SCIPY_ARRAY_API is not set.
    """
    match = "has experimental support for Python Array API"
    assert func.__doc__.count(match) == 1


@pytest.mark.parametrize('func,n_args',
                         [(nfo.wrapper, nfo.n_args) for nfo in _special_funcs])
def test_ufunc_kwargs(func, n_args):
    """Test that numpy-specific out= and dtype= keyword arguments
    of ufuncs still work when SCIPY_ARRAY_API is set.
    """
    # out=
    args = [np.asarray([.1, .2])] * n_args
    out = np.empty(2)
    y = func(*args, out=out)
    xp_assert_close(y, out)

    # out= with out.dtype != args.dtype
    out = np.empty(2, dtype=np.float32)
    y = func(*args, out=out)
    xp_assert_close(y, out)

    # dtype=
    y = func(*args, dtype=np.float32)
    assert y.dtype == np.float32



@make_xp_test_case(special.chdtr)
def test_chdtr_gh21311(xp):
    # the edge case behavior of generic chdtr was not right; see gh-21311
    # be sure to test at least these cases
    # should add `np.nan` into the mix when gh-21317 is resolved
    x = np.asarray([-np.inf, -1., 0., 1., np.inf])
    v = x.reshape(-1, 1)
    ref = special.chdtr(v, x)
    res = special.chdtr(xp.asarray(v), xp.asarray(x))
    xp_assert_close(res, xp.asarray(ref))
