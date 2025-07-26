import os
import platform
import sysconfig

import pytest

from scipy._lib._testutils import IS_EDITABLE,_test_cython_extension, cython
from scipy.special import beta, gamma


@pytest.mark.fail_slow(40)
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
    assert extensions.cy_beta(0.5, 0.1) == beta(0.5, 0.1)
    assert extensions.cy_gamma(0.5 + 1.0j) == gamma(0.5 + 1.0j)
    assert extensions_cpp.cy_beta(0.5, 0.1) == beta(0.5, 0.1)
    assert extensions_cpp.cy_gamma(0.5 + 1.0j) == gamma(0.5 + 1.0j)
