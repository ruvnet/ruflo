"""Utility functions.

Don't import from here directly anymore, as these are only
here for backwards compatibility.
"""
from kombu.utils.objects import cached_property
from kombu.utils.uuid import uuid

from .functional import chunks, memoize, noop
from .imports import gen_task_name, import_from_cwd, instantiate
from .imports import qualname as get_full_cls_name
from .imports import symbol_by_name as get_cls_by_name
# ------------------------------------------------------------------------ #
# > XXX Compat
from .log import LOG_LEVELS
from .nodenames import nodename, nodesplit, worker_direct

gen_unique_id = uuid

__all__ = (
    'LOG_LEVELS',
    'cached_property',
    'chunks',
    'gen_task_name',
    'gen_task_name',
    'gen_unique_id',
    'get_cls_by_name',
    'get_full_cls_name',
    'import_from_cwd',
    'instantiate',
    'memoize',
    'nodename',
    'nodesplit',
    'noop',
    'uuid',
    'worker_direct'
)
