"""Create Celery app instances used for testing."""
import weakref
from contextlib import contextmanager
from copy import deepcopy

from kombu.utils.imports import symbol_by_name

from celery import Celery, _state

#: Contains the default configuration values for the test app.
DEFAULT_TEST_CONFIG = {
    'worker_hijack_root_logger': False,
    'worker_log_color': False,
    'accept_content': {'json'},
    'enable_utc': True,
    'timezone': 'UTC',
    'broker_url': 'memory://',
    'result_backend': 'cache+memory://',
    'broker_heartbeat': 0,
}


class Trap:
    """Trap that pretends to be an app but raises an exception instead.

    This to protect from code that does not properly pass app instances,
    then falls back to the current_app.
    """

    def __getattr__(self, name):
        # Workaround to allow unittest.mock to patch this object
        # in Python 3.8 and above.
        if name == '_is_coroutine' or name == '__func__':
            return None
        print(name)
        raise RuntimeError('Test depends on current_app')


class UnitLogging(symbol_by_name(Celery.log_cls)):
    """Sets up logging for the test application."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.already_setup = True


def TestApp(name=None, config=None, enable_logging=False, set_as_current=False,
            log=UnitLogging, backend=None, broker=None, **kwargs):
    """App used for testing."""
    from . import tasks  # noqa
    config = dict(deepcopy(DEFAULT_TEST_CONFIG), **config or {})
    if broker is not None:
        config.pop('broker_url', None)
    if backend is not None:
        config.pop('result_backend', None)
    log = None if enable_logging else log
    test_app = Celery(
        name or 'celery.tests',
        set_as_current=set_as_current,
        log=log,
        broker=broker,
        backend=backend,
        **kwargs)
    test_app.add_defaults(config)
    return test_app


@contextmanager
def set_trap(app):
    """Contextmanager that installs the trap app.

    The trap means that anything trying to use the current or default app
    will raise an exception.
    """
    trap = Trap()
    prev_tls = _state._tls
    _state.set_default_app(trap)

    class NonTLS:
        current_app = trap
    _state._tls = NonTLS()

    try:
        yield
    finally:
        _state._tls = prev_tls


@contextmanager
def setup_default_app(app, use_trap=False):
    """Setup default app for testing.

    Ensures state is clean after the test returns.
    """
    prev_current_app = _state.get_current_app()
    prev_default_app = _state.default_app
    prev_finalizers = set(_state._on_app_finalizers)
    prev_apps = weakref.WeakSet(_state._apps)

    try:
        if use_trap:
            with set_trap(app):
                yield
        else:
            yield
    finally:
        _state.set_default_app(prev_default_app)
        _state._tls.current_app = prev_current_app
        if app is not prev_current_app:
            app.close()
        _state._on_app_finalizers = prev_finalizers
        _state._apps = prev_apps
