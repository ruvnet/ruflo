"""Pool implementation abstract factory, and alias definitions."""
import os

# Import from kombu directly as it's used
# early in the import stage, where celery.utils loads
# too much (e.g., for eventlet patching)
from kombu.utils.imports import symbol_by_name

__all__ = ('get_implementation', 'get_available_pool_names',)

ALIASES = {
    'prefork': 'celery.concurrency.prefork:TaskPool',
    'eventlet': 'celery.concurrency.eventlet:TaskPool',
    'gevent': 'celery.concurrency.gevent:TaskPool',
    'solo': 'celery.concurrency.solo:TaskPool',
    'processes': 'celery.concurrency.prefork:TaskPool',  # XXX compat alias
}

try:
    import concurrent.futures  # noqa
except ImportError:
    pass
else:
    ALIASES['threads'] = 'celery.concurrency.thread:TaskPool'
#
# Allow for an out-of-tree worker pool implementation. This is used as follows:
#
#   - Set the environment variable CELERY_CUSTOM_WORKER_POOL to the name of
#     an implementation of :class:`celery.concurrency.base.BasePool` in the
#     standard Celery format of "package:class".
#   - Select this pool using '--pool custom'.
#
try:
    custom = os.environ.get('CELERY_CUSTOM_WORKER_POOL')
except KeyError:
    pass
else:
    ALIASES['custom'] = custom


def get_implementation(cls):
    """Return pool implementation by name."""
    return symbol_by_name(cls, ALIASES)


def get_available_pool_names():
    """Return all available pool type names."""
    return tuple(ALIASES.keys())
