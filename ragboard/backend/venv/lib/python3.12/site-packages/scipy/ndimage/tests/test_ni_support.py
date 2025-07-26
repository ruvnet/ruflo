import pytest

import numpy as np
from .._ni_support import _get_output


@pytest.mark.parametrize(
    'dtype',
    [
        # String specifiers
        'f4', 'float32', 'complex64', 'complex128',
        # Type and dtype specifiers
        np.float32, float, np.dtype('f4'),
        # Derive from input
        None,
    ],
)
def test_get_output_basic(dtype):
    shape = (2, 3)

    input_ = np.zeros(shape, dtype='float32')

    # For None, derive dtype from input
    expected_dtype = 'float32' if dtype is None else dtype

    # Output is dtype-specifier, retrieve shape from input
    result = _get_output(dtype, input_)
    assert result.shape == shape
    assert result.dtype == np.dtype(expected_dtype)

    # Output is dtype specifier, with explicit shape, overriding input
    result = _get_output(dtype, input_, shape=(3, 2))
    assert result.shape == (3, 2)
    assert result.dtype == np.dtype(expected_dtype)

    # Output is pre-allocated array, return directly
    output = np.zeros(shape, dtype=dtype)
    result = _get_output(output, input_)
    assert result is output


@pytest.mark.thread_unsafe
def test_get_output_complex():
    shape = (2, 3)

    input_ = np.zeros(shape)

    # None, promote input type to complex
    result = _get_output(None, input_, complex_output=True)
    assert result.shape == shape
    assert result.dtype == np.dtype('complex128')

    # Explicit type, promote type to complex
    with pytest.warns(UserWarning, match='promoting specified output dtype to complex'):
        result = _get_output(float, input_, complex_output=True)
    assert result.shape == shape
    assert result.dtype == np.dtype('complex128')

    # String specifier, simply verify complex output
    result = _get_output('complex64', input_, complex_output=True)
    assert result.shape == shape
    assert result.dtype == np.dtype('complex64')


def test_get_output_error_cases():
    input_ = np.zeros((2, 3), 'float32')

    # Two separate paths can raise the same error
    with pytest.raises(RuntimeError, match='output must have complex dtype'):
        _get_output('float32', input_, complex_output=True)
    with pytest.raises(RuntimeError, match='output must have complex dtype'):
        _get_output(np.zeros((2, 3)), input_, complex_output=True)

    with pytest.raises(RuntimeError, match='output must have numeric dtype'):
        _get_output('void', input_)

    with pytest.raises(RuntimeError, match='shape not correct'):
        _get_output(np.zeros((3, 2)), input_)
