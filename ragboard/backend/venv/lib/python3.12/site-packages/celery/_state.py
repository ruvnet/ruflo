"""Internal state.

This is an internal module containing thread state
like the ``current_app``, and ``current_task``.

This module shouldn't be used directly.
"""

import os
import sys
import threading
import weakref

from celery.local import Proxy
from celery.utils.threads import LocalStack

__all__ = (
    'set_default_app', 'get_current_app', 'get_current_task',
    'get_current_worker_task', 'current_app', 'current_task',
    'connect_on_app_finalize',
)

#: Global default app used when no current app.
default_app = None

#: Function returning the app provided or the default app if none.
#:
#: The environment variable :envvar:`CELERY_TRACE_APP` is used to
#: trace app leaks.  When enabled an exception is raised if there
#: is no active app.
app_or_default = None

#: List of all app instances (weakrefs), mustn't be used directly.
_apps = weakref.WeakSet()

#: Global set of functions to call whenever a new app is finalized.
#: Shared tasks, and built-in tasks are created by adding callbacks here.
_on_app_finalizers = set()

_task_join_will_block = False


def connect_on_app_finalize(callback):
    """Connect callback to be called when any app is finalized."""
    _on_app_finalizers.add(callback)
    return callback


def _announce_app_finalized(app):
    callbacks = set(_on_app_finalizers)
    for callback in callbacks:
        callback(app)


def _set_task_join_will_block(blocks):
    global _task_join_will_block
    _task_join_will_block = blocks


def task_join_will_block():
    return _task_join_will_block


class _TLS(threading.local):
    #: Apps with the :attr:`~celery.app.base.BaseApp.set_as_current` attribute
    #: sets this, so it will always contain the last instantiated app,
    #: and is the default app returned by :func:`app_or_default`.
    current_app = None


_tls = _TLS()

_task_stack = LocalStack()


#: Function used to push a task to the thread local stack
#: keeping track of the currently executing task.
#: You must remember to pop the task after.
push_current_task = _task_stack.push

#: Function used to pop a task from the thread local stack
#: keeping track of the currently executing task.
pop_current_task = _task_stack.pop


def set_default_app(app):
    """Set default app."""
    global default_app
    default_app = app


def _get_current_app():
    if default_app is None:
        #: creates the global fallback app instance.
        from celery.app.base import Celery
        set_default_app(Celery(
            'default', fixups=[], set_as_current=False,
            loader=os.environ.get('CELERY_LOADER') or 'default',
        ))
    return _tls.current_app or default_app


def _set_current_app(app):
    _tls.current_app = app


if os.environ.get('C_STRICT_APP'):  # pragma: no cover
    def get_current_app():
        """Return the current app."""
        raise RuntimeError('USES CURRENT APP')
elif os.environ.get('C_WARN_APP'):  # pragma: no cover
    def get_current_app():
        import traceback
        print('-- USES CURRENT_APP', file=sys.stderr)  # +
        traceback.print_stack(file=sys.stderr)
        return _get_current_app()
else:
    get_current_app = _get_current_app


def get_current_task():
    """Currently executing task."""
    return _task_stack.top


def get_current_worker_task():
    """Currently executing task, that was applied by the worker.

    This is used to differentiate between the actual task
    executed by the worker and any task that was called within
    a task (using ``task.__call__`` or ``task.apply``)
    """
    for task in reversed(_task_stack.stack):
        if not task.request.called_directly:
            return task


#: Proxy to current app.
current_app = Proxy(get_current_app)

#: Proxy to current task.
current_task = Proxy(get_current_task)


def _register_app(app):
    _apps.add(app)


def _deregister_app(app):
    _apps.discard(app)


def _get_active_apps():
    return _apps


def _app_or_default(app=None):
    if app is None:
        return get_current_app()
    return app


def _app_or_default_trace(app=None):  # pragma: no cover
    from traceback import print_stack
    try:
        from billiard.process import current_process
    except ImportError:
        current_process = None
    if app is None:
        if getattr(_tls, 'current_app', None):
            print('-- RETURNING TO CURRENT APP --')  # +
            print_stack()
            return _tls.current_app
        if not current_process or current_process()._name == 'MainProcess':
            raise Exception('DEFAULT APP')
        print('-- RETURNING TO DEFAULT APP --')      # +
        print_stack()
        return default_app
    return app


def enable_trace():
    """Enable tracing of app instances."""
    global app_or_default
    app_or_default = _app_or_default_trace


def disable_trace():
    """Disable tracing of app instances."""
    global app_or_default
    app_or_default = _app_or_default


if os.environ.get('CELERY_TRACE_APP'):  # pragma: no cover
    enable_trace()
else:
    disable_trace()
