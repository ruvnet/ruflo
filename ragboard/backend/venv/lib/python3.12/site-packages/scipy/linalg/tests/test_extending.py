import os
import platform
import sysconfig

import numpy as np
import pytest

from scipy._lib._testutils import IS_EDITABLE, _test_cython_extension, cython
from scipy.linalg.blas import cdotu  # type: ignore[attr-defined]
from scipy.linalg.lapack import dgtsv  # type: ignore[attr-defined]


@pytest.mark.fail_slow(120)
# essential per https://github.com/scipy/scipy/pull/20487#discussion_r1567057247
@pytest.mark.skipif(IS_EDITABLE,
                    reason='Editable install cannot find .pxd headers.')
@pytest.mark.skipif((platform.system() == 'Windows' and
                     sysconfig.get_config_var('Py_GIL_DISABLED')),
                    reason='gh-22039')
@pytest.mark.skipif(platform.machine() in ["wasm32", "wasm64"],
                    reason="Can't start subprocess")
@pytest.mark.skipif(cython is None, reason="requires cython")
def test_cython(tmp_path):
    srcdir = os.path.dirname(os.path.dirname(__file__))
    extensions, extensions_cpp = _test_cython_extension(tmp_path, srcdir)
    # actually test the cython c-extensions
    a = np.ones(8) * 3
    b = np.ones(9)
    c = np.ones(8) * 4
    x = np.ones(9)
    _, _, _, x, _ = dgtsv(a, b, c, x)
    a = np.ones(8) * 3
    b = np.ones(9)
    c = np.ones(8) * 4
    x_c = np.ones(9)
    extensions.tridiag(a, b, c, x_c)
    a = np.ones(8) * 3
    b = np.ones(9)
    c = np.ones(8) * 4
    x_cpp = np.ones(9)
    extensions_cpp.tridiag(a, b, c, x_cpp)
    np.testing.assert_array_equal(x, x_cpp)
    cx = np.array([1-1j, 2+2j, 3-3j], dtype=np.complex64)
    cy = np.array([4+4j, 5-5j, 6+6j], dtype=np.complex64)
    np.testing.assert_array_equal(cdotu(cx, cy), extensions.complex_dot(cx, cy))
    np.testing.assert_array_equal(cdotu(cx, cy), extensions_cpp.complex_dot(cx, cy))
