from dask.array.fft import * # noqa: F403
# dask.array.fft doesn't have __all__. If it is added, replace this with
#
# from dask.array.fft import __all__ as linalg_all
_n = {}
exec('from dask.array.fft import *', _n)
for k in ("__builtins__", "Sequence", "annotations", "warnings"):
    _n.pop(k, None)
fft_all = list(_n)
del _n, k

from ...common import _fft
from ..._internal import get_xp

import dask.array as da

fftfreq = get_xp(da)(_fft.fftfreq)
rfftfreq = get_xp(da)(_fft.rfftfreq)

__all__ = fft_all + ["fftfreq", "rfftfreq"]
_all_ignore = ["da", "fft_all", "get_xp", "warnings"]
