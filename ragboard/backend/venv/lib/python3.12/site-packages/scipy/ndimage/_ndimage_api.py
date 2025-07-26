"""This is the 'bare' ndimage API.

This --- private! --- module only collects implementations of public ndimage API
for _support_alternative_backends.
The latter --- also private! --- module adds delegation to CuPy etc and
re-exports decorated names to __init__.py
"""

from ._filters import *    # noqa: F403
from ._fourier import *   # noqa: F403
from ._interpolation import *   # noqa: F403
from ._measurements import *   # noqa: F403
from ._morphology import *   # noqa: F403

# '@' due to pytest bug, scipy/scipy#22236
__all__ = [s for s in dir() if not s.startswith(('_', '@'))]
