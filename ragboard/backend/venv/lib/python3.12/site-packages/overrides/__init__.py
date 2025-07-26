from overrides.enforce import EnforceOverrides
import sys

if sys.version_info < (3, 11):
    from overrides.final import final
else:
    from typing import final
from overrides.overrides import __VERSION__, overrides, override


__all__ = [
    "__VERSION__",
    "override",
    "overrides",
    "final",
    "EnforceOverrides",
]
