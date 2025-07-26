"""This is the 'bare' scipy.signal API.

This --- private! --- module only collects implementations of public  API
for _support_alternative_backends.
The latter --- also private! --- module adds delegation to CuPy etc and
re-exports decorated names to __init__.py
"""

from . import _sigtools, windows         # noqa: F401
from ._waveforms import *        # noqa: F403
from ._max_len_seq import max_len_seq       # noqa: F401
from ._upfirdn import upfirdn         # noqa: F401

from ._spline import sepfir2d          # noqa: F401

from ._spline_filters import *         # noqa: F403
from ._filter_design import *         # noqa: F403
from ._fir_filter_design import *         # noqa: F403
from ._ltisys import *         # noqa: F403
from ._lti_conversion import *         # noqa: F403
from ._signaltools import *         # noqa: F403
from ._savitzky_golay import savgol_coeffs, savgol_filter  # noqa: F401
from ._spectral_py import *         # noqa: F403
from ._short_time_fft import *         # noqa: F403
from ._peak_finding import *         # noqa: F403
from ._czt import *         # noqa: F403
from .windows import get_window  # keep this one in signal namespace  # noqa: F401


__all__ = [s for s in dir() if not s.startswith('_')]
