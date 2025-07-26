from cupy.fft import * # noqa: F403
# cupy.fft doesn't have __all__. If it is added, replace this with
#
# from cupy.fft import __all__ as linalg_all
_n = {}
exec('from cupy.fft import *', _n)
del _n['__builtins__']
fft_all = list(_n)
del _n

from ..common import _fft
from .._internal import get_xp

import cupy as cp

fft = get_xp(cp)(_fft.fft)
ifft = get_xp(cp)(_fft.ifft)
fftn = get_xp(cp)(_fft.fftn)
ifftn = get_xp(cp)(_fft.ifftn)
rfft = get_xp(cp)(_fft.rfft)
irfft = get_xp(cp)(_fft.irfft)
rfftn = get_xp(cp)(_fft.rfftn)
irfftn = get_xp(cp)(_fft.irfftn)
hfft = get_xp(cp)(_fft.hfft)
ihfft = get_xp(cp)(_fft.ihfft)
fftfreq = get_xp(cp)(_fft.fftfreq)
rfftfreq = get_xp(cp)(_fft.rfftfreq)
fftshift = get_xp(cp)(_fft.fftshift)
ifftshift = get_xp(cp)(_fft.ifftshift)

__all__ = fft_all + _fft.__all__

del get_xp
del cp
del fft_all
del _fft
