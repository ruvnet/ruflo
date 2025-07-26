"""Test that all ufuncs have float32-preserving signatures.

This was once guaranteed through the code generation script for
generating ufuncs, `scipy/special/_generate_pyx.py`. Starting with
gh-20260, SciPy developers have begun moving to generate ufuncs
through direct use of the NumPy C API (through C++). Existence of
float32 preserving signatures must now be tested since it is no
longer guaranteed.
"""

import numpy as np
import pytest
import scipy.special._ufuncs
import scipy.special._gufuncs

_ufuncs = []
for funcname in dir(scipy.special._ufuncs):
    _ufuncs.append(getattr(scipy.special._ufuncs, funcname))
for funcname in dir(scipy.special._gufuncs):
    _ufuncs.append(getattr(scipy.special._gufuncs, funcname))

# Not all module members are actually ufuncs
_ufuncs = [func for func in _ufuncs if isinstance(func, np.ufunc)]

@pytest.mark.parametrize("ufunc", _ufuncs)
def test_ufunc_signatures(ufunc):

    # From _generate_pyx.py
    # "Don't add float32 versions of ufuncs with integer arguments, as this
    # can lead to incorrect dtype selection if the integer arguments are
    # arrays, but float arguments are scalars.
    # For instance sph_harm(0,[0],0,0).dtype == complex64
    # This may be a NumPy bug, but we need to work around it.
    # cf. gh-4895, https://github.com/numpy/numpy/issues/5895"
    types = set(sig for sig in ufunc.types
                if not ("l" in sig or "i" in sig or "q" in sig or "p" in sig))

    # Generate the full expanded set of signatures which should exist. There
    # should be matching float and double versions of any existing signature.
    expanded_types = set()
    for sig in types:
        expanded_types.update(
            [sig.replace("d", "f").replace("D", "F"),
             sig.replace("f", "d").replace("F", "D")]
        )
    assert types == expanded_types
