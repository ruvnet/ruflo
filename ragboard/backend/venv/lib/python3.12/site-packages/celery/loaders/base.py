"""Loader base class."""
import importlib
import os
import re
import sys
from datetime import datetime

from kombu.utils import json
from kombu.utils.objects import cached_property

from celery import signals
from celery.exceptions import reraise
from celery.utils.collections import DictAttribute, force_mapping
from celery.utils.functional import maybe_list
from celery.utils.imports import NotAPackage, find_module, import_from_cwd, symbol_by_name

__all__ = ('BaseLoader',)

_RACE_PROTECTION = False

CONFIG_INVALID_NAME = """\
Error: Module '{module}' doesn't exist, or it's not a valid \
Python module name.
"""

CONFIG_WITH_SUFFIX = CONFIG_INVALID_NAME + """\
Did you mean '{suggest}'?
"""

unconfigured = object()


class BaseLoader:
    """Base class for loaders.

    Loaders handles,

        * Reading celery client/worker configurations.

        * What happens when a task starts?
            See :meth:`on_task_init`.

        * What happens when the worker starts?
            See :meth:`on_worker_init`.

        * What happens when the worker shuts down?
            See :meth:`on_worker_shutdown`.

        * What modules are imported to find tasks?
    """

    builtin_modules = frozenset()
    configured = False
    override_backends = {}
    worker_initialized = False

    _conf = unconfigured

    def __init__(self, app, **kwargs):
        self.app = app
        self.task_modules = set()

    def now(self, utc=True):
        if utc:
            return datetime.utcnow()
        return datetime.now()

    def on_task_init(self, task_id, task):
        """Called before a task is executed."""

    def on_process_cleanup(self):
        """Called after a task is executed."""

    def on_worker_init(self):
        """Called when the worker (:program:`celery worker`) starts."""

    def on_worker_shutdown(self):
        """Called when the worker (:program:`celery worker`) shuts down."""

    def on_worker_process_init(self):
        """Called when a child process starts."""

    def import_task_module(self, module):
        self.task_modules.add(module)
        return self.import_from_cwd(module)

    def import_module(self, module, package=None):
        return importlib.import_module(module, package=package)

    def import_from_cwd(self, module, imp=None, package=None):
        return import_from_cwd(
            module,
            self.import_module if imp is None else imp,
            package=package,
        )

    def import_default_modules(self):
        responses = signals.import_modules.send(sender=self.app)
        # Prior to this point loggers are not yet set up properly, need to
        #   check responses manually and reraised exceptions if any, otherwise
        #   they'll be silenced, making it incredibly difficult to debug.
        for _, response in responses:
            if isinstance(response, Exception):
                raise response
        return [self.import_task_module(m) for m in self.default_modules]

    def init_worker(self):
        if not self.worker_initialized:
            self.worker_initialized = True
            self.import_default_modules()
            self.on_worker_init()

    def shutdown_worker(self):
        self.on_worker_shutdown()

    def init_worker_process(self):
        self.on_worker_process_init()

    def config_from_object(self, obj, silent=False):
        if isinstance(obj, str):
            try:
                obj = self._smart_import(obj, imp=self.import_from_cwd)
            except (ImportError, AttributeError):
                if silent:
                    return False
                raise
        self._conf = force_mapping(obj)
        if self._conf.get('override_backends') is not None:
            self.override_backends = self._conf['override_backends']
        return True

    def _smart_import(self, path, imp=None):
        imp = self.import_module if imp is None else imp
        if ':' in path:
            # Path includes attribute so can just jump
            # here (e.g., ``os.path:abspath``).
            return symbol_by_name(path, imp=imp)

        # Not sure if path is just a module name or if it includes an
        # attribute name (e.g., ``os.path``, vs, ``os.path.abspath``).
        try:
            return imp(path)
        except ImportError:
            # Not a module name, so try module + attribute.
            return symbol_by_name(path, imp=imp)

    def _import_config_module(self, name):
        try:
            self.find_module(name)
        except NotAPackage as exc:
            if name.endswith('.py'):
                reraise(NotAPackage, NotAPackage(CONFIG_WITH_SUFFIX.format(
                        module=name, suggest=name[:-3])), sys.exc_info()[2])
            raise NotAPackage(CONFIG_INVALID_NAME.format(module=name)) from exc
        else:
            return self.import_from_cwd(name)

    def find_module(self, module):
        return find_module(module)

    def cmdline_config_parser(self, args, namespace='celery',
                              re_type=re.compile(r'\((\w+)\)'),
                              extra_types=None,
                              override_types=None):
        extra_types = extra_types if extra_types else {'json': json.loads}
        override_types = override_types if override_types else {
            'tuple': 'json',
            'list': 'json',
            'dict': 'json'
        }
        from celery.app.defaults import NAMESPACES, Option
        namespace = namespace and namespace.lower()
        typemap = dict(Option.typemap, **extra_types)

        def getarg(arg):
            """Parse single configuration from command-line."""
            # ## find key/value
            # ns.key=value|ns_key=value (case insensitive)
            key, value = arg.split('=', 1)
            key = key.lower().replace('.', '_')

            # ## find name-space.
            # .key=value|_key=value expands to default name-space.
            if key[0] == '_':
                ns, key = namespace, key[1:]
            else:
                # find name-space part of key
                ns, key = key.split('_', 1)

            ns_key = (ns and ns + '_' or '') + key

            # (type)value makes cast to custom type.
            cast = re_type.match(value)
            if cast:
                type_ = cast.groups()[0]
                type_ = override_types.get(type_, type_)
                value = value[len(cast.group()):]
                value = typemap[type_](value)
            else:
                try:
                    value = NAMESPACES[ns.lower()][key].to_python(value)
                except ValueError as exc:
                    # display key name in error message.
                    raise ValueError(f'{ns_key!r}: {exc}')
            return ns_key, value
        return dict(getarg(arg) for arg in args)

    def read_configuration(self, env='CELERY_CONFIG_MODULE'):
        try:
            custom_config = os.environ[env]
        except KeyError:
            pass
        else:
            if custom_config:
                usercfg = self._import_config_module(custom_config)
                return DictAttribute(usercfg)

    def autodiscover_tasks(self, packages, related_name='tasks'):
        self.task_modules.update(
            mod.__name__ for mod in autodiscover_tasks(packages or (),
                                                       related_name) if mod)

    @cached_property
    def default_modules(self):
        return (
            tuple(self.builtin_modules) +
            tuple(maybe_list(self.app.conf.imports)) +
            tuple(maybe_list(self.app.conf.include))
        )

    @property
    def conf(self):
        """Loader configuration."""
        if self._conf is unconfigured:
            self._conf = self.read_configuration()
        return self._conf


def autodiscover_tasks(packages, related_name='tasks'):
    global _RACE_PROTECTION

    if _RACE_PROTECTION:
        return ()
    _RACE_PROTECTION = True
    try:
        return [find_related_module(pkg, related_name) for pkg in packages]
    finally:
        _RACE_PROTECTION = False


def find_related_module(package, related_name):
    """Find module in package."""
    # Django 1.7 allows for specifying a class name in INSTALLED_APPS.
    # (Issue #2248).
    try:
        module = importlib.import_module(package)
        if not related_name and module:
            return module
    except ImportError:
        package, _, _ = package.rpartition('.')
        if not package:
            raise

    module_name = f'{package}.{related_name}'

    try:
        return importlib.import_module(module_name)
    except ImportError as e:
        import_exc_name = getattr(e, 'name', module_name)
        if import_exc_name is not None and import_exc_name != module_name:
            raise e
        return
