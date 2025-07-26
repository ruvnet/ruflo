"""DEPRECATED - Import from modules below."""

from __future__ import annotations

from .collections import EqualityDict
from .compat import fileno, maybe_fileno, nested, register_after_fork
from .div import emergency_dump_state
from .functional import (fxrange, fxrangemax, maybe_list, reprcall,
                         retry_over_time)
from .imports import symbol_by_name
from .objects import cached_property
from .uuid import uuid

__all__ = (
    'EqualityDict', 'uuid', 'maybe_list',
    'fxrange', 'fxrangemax', 'retry_over_time',
    'emergency_dump_state', 'cached_property',
    'register_after_fork', 'reprkwargs', 'reprcall',
    'symbol_by_name', 'nested', 'fileno', 'maybe_fileno',
)
