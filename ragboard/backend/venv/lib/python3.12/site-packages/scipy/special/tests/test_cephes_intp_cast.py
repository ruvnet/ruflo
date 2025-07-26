import pytest
import numpy as np
from scipy.special._ufuncs import (
    _smirnovc, _smirnovci, _smirnovp,
    _struve_asymp_large_z, _struve_bessel_series, _struve_power_series,
    bdtr, bdtrc, bdtri, expn, kn, nbdtr, nbdtrc, nbdtri, pdtri,
    smirnov, smirnovi, yn
)


#
# For each ufunc here, verify that the default integer type, np.intp,
# can be safely cast to the integer type found in the input type signatures.
# For this particular set of functions, the code expects to find just one
# integer type among the input signatures.
#
@pytest.mark.parametrize(
    'ufunc',
    [_smirnovc, _smirnovci, _smirnovp,
     _struve_asymp_large_z, _struve_bessel_series, _struve_power_series,
     bdtr, bdtrc, bdtri, expn, kn, nbdtr, nbdtrc, nbdtri, pdtri,
     smirnov, smirnovi, yn],
)
def test_intp_safe_cast(ufunc):
    int_chars = {'i', 'l', 'q'}
    int_input = [set(sig.split('->')[0]) & int_chars for sig in ufunc.types]
    int_char = ''.join(s.pop() if s else '' for s in int_input)
    assert len(int_char) == 1, "More integer types in the signatures than expected"
    assert np.can_cast(np.intp, np.dtype(int_char))
