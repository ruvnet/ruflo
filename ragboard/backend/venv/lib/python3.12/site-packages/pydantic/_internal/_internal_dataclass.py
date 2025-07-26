import sys
from typing import Any, Dict

dataclass_kwargs: Dict[str, Any]

# `slots` is available on Python >= 3.10
if sys.version_info >= (3, 10):
    slots_true = {'slots': True}
else:
    slots_true = {}
