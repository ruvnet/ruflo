# This file is dual licensed under the terms of the Apache License, Version
# 2.0, and the BSD License. See the LICENSE file in the root of this repository
# for complete details.

from __future__ import annotations

import sys
import warnings

from cryptography import utils
from cryptography.__about__ import __author__, __copyright__, __version__

__all__ = [
    "__author__",
    "__copyright__",
    "__version__",
]

if sys.version_info[:2] == (3, 7):
    warnings.warn(
        "Python 3.7 is no longer supported by the Python core team "
        "and support for it is deprecated in cryptography. The next release "
        "of cryptography will remove support for Python 3.7.",
        utils.CryptographyDeprecationWarning,
        stacklevel=2,
    )
