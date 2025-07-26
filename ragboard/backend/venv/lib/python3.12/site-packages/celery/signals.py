"""Celery Signals.

This module defines the signals (Observer pattern) sent by
both workers and clients.

Functions can be connected to these signals, and connected
functions are called whenever a signal is called.

.. seealso::

    :ref:`signals` for more information.
"""

from .utils.dispatch import Signal

__all__ = (
    'before_task_publish', 'after_task_publish', 'task_internal_error',
    'task_prerun', 'task_postrun', 'task_success',
    'task_received', 'task_rejected', 'task_unknown',
    'task_retry', 'task_failure', 'task_revoked', 'celeryd_init',
    'celeryd_after_setup', 'worker_init', 'worker_before_create_process',
    'worker_process_init', 'worker_process_shutdown', 'worker_ready',
    'worker_shutdown', 'worker_shutting_down', 'setup_logging',
    'after_setup_logger', 'after_setup_task_logger', 'beat_init',
    'beat_embedded_init', 'heartbeat_sent', 'eventlet_pool_started',
    'eventlet_pool_preshutdown', 'eventlet_pool_postshutdown',
    'eventlet_pool_apply',
)

# - Task
before_task_publish = Signal(
    name='before_task_publish',
    providing_args={
        'body', 'exchange', 'routing_key', 'headers',
        'properties', 'declare', 'retry_policy',
    },
)
after_task_publish = Signal(
    name='after_task_publish',
    providing_args={'body', 'exchange', 'routing_key'},
)
task_received = Signal(
    name='task_received',
    providing_args={'request'}
)
task_prerun = Signal(
    name='task_prerun',
    providing_args={'task_id', 'task', 'args', 'kwargs'},
)
task_postrun = Signal(
    name='task_postrun',
    providing_args={'task_id', 'task', 'args', 'kwargs', 'retval'},
)
task_success = Signal(
    name='task_success',
    providing_args={'result'},
)
task_retry = Signal(
    name='task_retry',
    providing_args={'request', 'reason', 'einfo'},
)
task_failure = Signal(
    name='task_failure',
    providing_args={
        'task_id', 'exception', 'args', 'kwargs', 'traceback', 'einfo',
    },
)
task_internal_error = Signal(
    name='task_internal_error',
    providing_args={
        'task_id', 'args', 'kwargs', 'request', 'exception', 'traceback', 'einfo'
    }
)
task_revoked = Signal(
    name='task_revoked',
    providing_args={
        'request', 'terminated', 'signum', 'expired',
    },
)
task_rejected = Signal(
    name='task_rejected',
    providing_args={'message', 'exc'},
)
task_unknown = Signal(
    name='task_unknown',
    providing_args={'message', 'exc', 'name', 'id'},
)
#: Deprecated, use after_task_publish instead.
task_sent = Signal(
    name='task_sent',
    providing_args={
        'task_id', 'task', 'args', 'kwargs', 'eta', 'taskset',
    },
)

# - Program: `celery worker`
celeryd_init = Signal(
    name='celeryd_init',
    providing_args={'instance', 'conf', 'options'},
)
celeryd_after_setup = Signal(
    name='celeryd_after_setup',
    providing_args={'instance', 'conf'},
)

# - Worker
import_modules = Signal(name='import_modules')
worker_init = Signal(name='worker_init')
worker_before_create_process = Signal(name="worker_before_create_process")
worker_process_init = Signal(name='worker_process_init')
worker_process_shutdown = Signal(name='worker_process_shutdown')
worker_ready = Signal(name='worker_ready')
worker_shutdown = Signal(name='worker_shutdown')
worker_shutting_down = Signal(name='worker_shutting_down')
heartbeat_sent = Signal(name='heartbeat_sent')

# - Logging
setup_logging = Signal(
    name='setup_logging',
    providing_args={
        'loglevel', 'logfile', 'format', 'colorize',
    },
)
after_setup_logger = Signal(
    name='after_setup_logger',
    providing_args={
        'logger', 'loglevel', 'logfile', 'format', 'colorize',
    },
)
after_setup_task_logger = Signal(
    name='after_setup_task_logger',
    providing_args={
        'logger', 'loglevel', 'logfile', 'format', 'colorize',
    },
)

# - Beat
beat_init = Signal(name='beat_init')
beat_embedded_init = Signal(name='beat_embedded_init')

# - Eventlet
eventlet_pool_started = Signal(name='eventlet_pool_started')
eventlet_pool_preshutdown = Signal(name='eventlet_pool_preshutdown')
eventlet_pool_postshutdown = Signal(name='eventlet_pool_postshutdown')
eventlet_pool_apply = Signal(
    name='eventlet_pool_apply',
    providing_args={'target', 'args', 'kwargs'},
)

# - Programs
user_preload_options = Signal(
    name='user_preload_options',
    providing_args={'app', 'options'},
)
