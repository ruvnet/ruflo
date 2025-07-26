from typing import Final

from dask.array import *  # noqa: F403

# These imports may overwrite names from the import * above.
from ._aliases import *  # noqa: F403

__array_api_version__: Final = "2024.12"

# See the comment in the numpy __init__.py
__import__(__package__ + '.linalg')
__import__(__package__ + '.fft')
