import re

import numpy as np
import pytest

from scipy._lib._array_api import (
    _GLOBAL_CONFIG, array_namespace, _asarray, xp_copy, xp_assert_equal, is_numpy,
    np_compat, xp_default_dtype, xp_result_type, is_torch
)
from scipy._lib import array_api_extra as xpx
from scipy._lib._array_api_no_0d import xp_assert_equal as xp_assert_equal_no_0d
from scipy._lib.array_api_extra.testing import lazy_xp_function


lazy_xp_function(_asarray)
lazy_xp_function(xp_copy)


@pytest.mark.skipif(not _GLOBAL_CONFIG["SCIPY_ARRAY_API"],
        reason="Array API test; set environment variable SCIPY_ARRAY_API=1 to run it")
class TestArrayAPI:

    def test_array_namespace(self):
        x, y = np.array([0, 1, 2]), np.array([0, 1, 2])
        xp = array_namespace(x, y)
        assert 'array_api_compat.numpy' in xp.__name__

        _GLOBAL_CONFIG["SCIPY_ARRAY_API"] = False
        xp = array_namespace(x, y)
        assert 'array_api_compat.numpy' in xp.__name__
        _GLOBAL_CONFIG["SCIPY_ARRAY_API"] = True

    def test_asarray(self, xp):
        x, y = _asarray([0, 1, 2], xp=xp), _asarray(np.arange(3), xp=xp)
        ref = xp.asarray([0, 1, 2])
        xp_assert_equal(x, ref)
        xp_assert_equal(y, ref)

    @pytest.mark.filterwarnings("ignore: the matrix subclass")
    def test_raises(self):
        msg = "of type `numpy.ma.MaskedArray` are not supported"
        with pytest.raises(TypeError, match=msg):
            array_namespace(np.ma.array(1), np.array(1))

        msg = "of type `numpy.matrix` are not supported"
        with pytest.raises(TypeError, match=msg):
            array_namespace(np.array(1), np.matrix(1))

        msg = "only boolean and numerical dtypes are supported"
        with pytest.raises(TypeError, match=msg):
            array_namespace([object()])
        with pytest.raises(TypeError, match=msg):
            array_namespace('abc')

    @pytest.mark.skip_xp_backends(np_only=True, reason="Array-likes")
    def test_array_likes(self, xp):
        """Test that if all parameters of array_namespace are Array-likes,
        the output is array_api_compat.numpy
        """
        assert array_namespace([0, 1, 2]) is xp
        assert array_namespace((0, 1, 2)) is xp
        assert array_namespace(1, 2, 3) is xp
        assert array_namespace(1) is xp
        assert array_namespace(np.int64(1)) is xp
        assert array_namespace([0, 1, 2], 3) is xp
        assert array_namespace() is xp
        assert array_namespace(None) is xp
        assert array_namespace(1, None) is xp
        assert array_namespace(None, 1) is xp

        # This only works when xp is numpy!
        assert array_namespace(np.asarray([1, 2]), [3, 4]) is xp
        assert array_namespace(np.int64(1), [3, 4]) is xp

    def test_array_and_array_likes_mix(self, xp):
        """Test that if there is at least one Array API object among
        the parameters of array_namespace, and all other parameters
        are scalars, the output is its namespace.

        If there are non-scalar Array-Likes, raise as in array-api-compat.
        """
        x = xp.asarray(1)
        assert array_namespace(x) is xp
        assert array_namespace(x, 1) is xp
        assert array_namespace(1, x) is xp
        assert array_namespace(None, x) is xp

        if not is_numpy(xp):
            with pytest.raises(TypeError, match="Multiple namespaces"):
                array_namespace(x, [1, 2])
            with pytest.raises(TypeError, match="Multiple namespaces"):
                array_namespace(x, np.int64(1))

    def test_array_api_extra_hook(self):
        """Test that the `array_namespace` function used by
        array-api-extra has been overridden by scipy
        """
        msg = "only boolean and numerical dtypes are supported"
        with pytest.raises(TypeError, match=msg):
            xpx.atleast_nd("abc", ndim=0)

    def test_copy(self, xp):
        for _xp in [xp, None]:
            x = xp.asarray([1, 2, 3])
            y = xp_copy(x, xp=_xp)
            # with numpy we'd want to use np.shared_memory, but that's not specified
            # in the array-api
            assert id(x) != id(y)
            try:
                y[0] = 10
            except (TypeError, ValueError):
                pass
            else:
                assert x[0] != y[0]
    
    @pytest.mark.parametrize('dtype', ['int32', 'int64', 'float32', 'float64'])
    @pytest.mark.parametrize('shape', [(), (3,)])
    def test_strict_checks(self, xp, dtype, shape):
        # Check that `_strict_check` behaves as expected
        dtype = getattr(xp, dtype)
        x = xp.broadcast_to(xp.asarray(1, dtype=dtype), shape)
        x = x if shape else x[()]
        y = np_compat.asarray(1)[()]

        kwarg_names = ["check_namespace", "check_dtype", "check_shape", "check_0d"]
        options = dict(zip(kwarg_names, [True, False, False, False]))
        if is_numpy(xp):
            xp_assert_equal(x, y, **options)
        else:
            with pytest.raises(
                AssertionError,
                match="Namespace of desired array does not match",
            ):
                xp_assert_equal(x, y, **options)
            with pytest.raises(
                AssertionError,
                match="Namespace of actual and desired arrays do not match",
            ):
                xp_assert_equal(y, x, **options)

        options = dict(zip(kwarg_names, [False, True, False, False]))
        if y.dtype.name in str(x.dtype):
            xp_assert_equal(x, y, **options)
        else:
            with pytest.raises(AssertionError, match="dtypes do not match."):
                xp_assert_equal(x, y, **options)

        options = dict(zip(kwarg_names, [False, False, True, False]))
        if x.shape == y.shape:
            xp_assert_equal(x, y, **options)
        else:
            with pytest.raises(AssertionError, match="Shapes do not match."):
                xp_assert_equal(x, xp.asarray(y), **options)

        options = dict(zip(kwarg_names, [False, False, False, True]))
        if is_numpy(xp) and x.shape == y.shape:
            xp_assert_equal(x, y, **options)
        elif is_numpy(xp):
            with pytest.raises(AssertionError, match="Array-ness does not match."):
                xp_assert_equal(x, y, **options)

    @pytest.mark.skip_xp_backends(np_only=True, reason="Scalars only exist in NumPy")
    def test_check_scalar(self, xp):
        # identity always passes
        xp_assert_equal(xp.float64(0), xp.float64(0))
        xp_assert_equal(xp.asarray(0.), xp.asarray(0.))
        xp_assert_equal(xp.float64(0), xp.float64(0), check_0d=False)
        xp_assert_equal(xp.asarray(0.), xp.asarray(0.), check_0d=False)

        # Check default convention: 0d-arrays are distinguished from scalars
        message = "Array-ness does not match:.*"
        with pytest.raises(AssertionError, match=message):
            xp_assert_equal(xp.asarray(0.), xp.float64(0))
        with pytest.raises(AssertionError, match=message):
            xp_assert_equal(xp.float64(0), xp.asarray(0.))
        with pytest.raises(AssertionError, match=message):
            xp_assert_equal(xp.asarray(42), xp.int64(42))
        with pytest.raises(AssertionError, match=message):
            xp_assert_equal(xp.int64(42), xp.asarray(42))

        # with `check_0d=False`, scalars-vs-0d passes (if values match)
        xp_assert_equal(xp.asarray(0.), xp.float64(0), check_0d=False)
        xp_assert_equal(xp.float64(0), xp.asarray(0.), check_0d=False)
        # also with regular python objects
        xp_assert_equal(xp.asarray(0.), 0., check_0d=False)
        xp_assert_equal(0., xp.asarray(0.), check_0d=False)
        xp_assert_equal(xp.asarray(42), 42, check_0d=False)
        xp_assert_equal(42, xp.asarray(42), check_0d=False)

        # as an alternative to `check_0d=False`, explicitly expect scalar
        xp_assert_equal(xp.float64(0), xp.asarray(0.)[()])

    @pytest.mark.skip_xp_backends(np_only=True, reason="Scalars only exist in NumPy")
    def test_check_scalar_no_0d(self, xp):
        # identity passes, if first argument is not 0d (or check_0d=True)
        xp_assert_equal_no_0d(xp.float64(0), xp.float64(0))
        xp_assert_equal_no_0d(xp.float64(0), xp.float64(0), check_0d=True)
        xp_assert_equal_no_0d(xp.asarray(0.), xp.asarray(0.), check_0d=True)

        # by default, 0d values are forbidden as the first argument
        message = "Result is a NumPy 0d-array.*"
        with pytest.raises(AssertionError, match=message):
            xp_assert_equal_no_0d(xp.asarray(0.), xp.asarray(0.))
        with pytest.raises(AssertionError, match=message):
            xp_assert_equal_no_0d(xp.asarray(0.), xp.float64(0))
        with pytest.raises(AssertionError, match=message):
            xp_assert_equal_no_0d(xp.asarray(42), xp.int64(42))

        # Check default convention: 0d-arrays are NOT distinguished from scalars
        xp_assert_equal_no_0d(xp.float64(0), xp.asarray(0.))
        xp_assert_equal_no_0d(xp.int64(42), xp.asarray(42))

        # opt in to 0d-check remains possible
        message = "Array-ness does not match:.*"
        with pytest.raises(AssertionError, match=message):
            xp_assert_equal_no_0d(xp.asarray(0.), xp.float64(0), check_0d=True)
        with pytest.raises(AssertionError, match=message):
            xp_assert_equal_no_0d(xp.float64(0), xp.asarray(0.), check_0d=True)
        with pytest.raises(AssertionError, match=message):
            xp_assert_equal_no_0d(xp.asarray(42), xp.int64(0), check_0d=True)
        with pytest.raises(AssertionError, match=message):
            xp_assert_equal_no_0d(xp.int64(0), xp.asarray(42), check_0d=True)

        # scalars-vs-0d passes (if values match) also with regular python objects
        xp_assert_equal_no_0d(0., xp.asarray(0.))
        xp_assert_equal_no_0d(42, xp.asarray(42))

    def test_default_dtype(self, xp):
        assert xp_default_dtype(xp) == xp.asarray(1.).dtype


scalars = [1, 1., 1. + 1j]
lists = [[1], [1.], [1. + 1j]]
types = ('int8 int16 int32 int64 '
         'uint8 uint16 uint32 uint64 '
         'float32 float64 complex64 complex128').split()
arrays = [np.asarray([1], dtype=getattr(np, t)) for t in types]


def convert_type(x, xp):
    # Convert NumPy array to xp-array
    # Convert string to indicated dtype from xp
    # Return Python scalars unchanged
    if isinstance(x, np.ndarray):
        return xp.asarray(x)
    elif isinstance(x, str):
        return getattr(xp, x)
    return x


def is_inexact(x, xp):
    # Determine whether `x` is of inexact (real of complex floating) dtype
    x = xp.asarray(x) if np.isscalar(x) or isinstance(x, list) else x
    dtype = getattr(x, 'dtype', x)
    return xp.isdtype(dtype, ('real floating', 'complex floating'))


@pytest.mark.parametrize('x', scalars + lists + types + arrays)
@pytest.mark.parametrize('y', scalars + lists + types + arrays)
def test_xp_result_type_no_force(x, y, xp):
    # When force_floating==False (default), behavior of `xp_result_type`
    # should match that of `xp.result_type` on the same arguments after
    # converting lists to arrays of type `xp`.
    x = convert_type(x, xp)
    y = convert_type(y, xp)
    x_ref = xp.asarray(x) if isinstance(x, list) else x
    y_ref = xp.asarray(y) if isinstance(y, list) else y

    try:
        dtype_ref = xp.result_type(x_ref, y_ref)
        expected_error = None
    except Exception as e:
        expected_error = (type(e), str(e))

    if expected_error is not None:
        with pytest.raises(expected_error[0], match=re.escape(expected_error[1])):
            xp_result_type(x, y, xp=xp)
        return

    dtype_res = xp_result_type(x, y, xp=xp)
    assert dtype_res == dtype_ref


@pytest.mark.parametrize('x', scalars + lists + types + arrays)
@pytest.mark.parametrize('y', scalars + lists + types + arrays)
def test_xp_result_type_force_floating(x, y, xp):
    # When `force_floating==True`, behavior of `xp_result_type`
    # should match that of `xp.result_type` with `1.0` appended to the set of
    # arguments (after converting lists to arrays of type `xp`).
    # If this raises a `TypeError`, which is the case when the result
    # type is not defined by the standard, the result type should be
    # the result type of any inexact (real or complex floating) arguments
    # and the default floating point type.
    if (is_torch(xp) and not(isinstance(x, str) or isinstance(y, str))
            and np.isscalar(x) and np.isscalar(y)):
        pytest.skip("See 3/27/2024 comment at  data-apis/array-api-compat#277")

    x = convert_type(x, xp)
    y = convert_type(y, xp)
    x_ref = xp.asarray(x) if isinstance(x, list) else x
    y_ref = xp.asarray(y) if isinstance(y, list) else y

    expected_error = None
    try:
        dtype_ref = xp.result_type(x_ref, y_ref, 1.0)
    except TypeError:
        args = []
        if is_inexact(x_ref, xp):
            args.append(x_ref)
        if is_inexact(y_ref, xp):
            args.append(y_ref)
        dtype_ref = xp.result_type(*args, xp.asarray(1.0))
    except Exception as e:
        expected_error = (type(e), str(e))

    if expected_error is not None:
        with pytest.raises(expected_error[0], match=expected_error[1]):
            xp_result_type(x, y, xp=xp)
        return

    dtype_res = xp_result_type(x, y, force_floating=True, xp=xp)
    assert dtype_res == dtype_ref
