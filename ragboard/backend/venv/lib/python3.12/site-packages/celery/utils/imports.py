"""Utilities related to importing modules and symbols by name."""
import os
import sys
import warnings
from contextlib import contextmanager
from importlib import import_module, reload

try:
    from importlib.metadata import entry_points
except ImportError:
    from importlib_metadata import entry_points

from kombu.utils.imports import symbol_by_name

#: Billiard sets this when execv is enabled.
#: We use it to find out the name of the original ``__main__``
#: module, so that we can properly rewrite the name of the
#: task to be that of ``App.main``.
MP_MAIN_FILE = os.environ.get('MP_MAIN_FILE')

__all__ = (
    'NotAPackage', 'qualname', 'instantiate', 'symbol_by_name',
    'cwd_in_path', 'find_module', 'import_from_cwd',
    'reload_from_cwd', 'module_file', 'gen_task_name',
)


class NotAPackage(Exception):
    """Raised when importing a package, but it's not a package."""


def qualname(obj):
    """Return object name."""
    if not hasattr(obj, '__name__') and hasattr(obj, '__class__'):
        obj = obj.__class__
    q = getattr(obj, '__qualname__', None)
    if '.' not in q:
        q = '.'.join((obj.__module__, q))
    return q


def instantiate(name, *args, **kwargs):
    """Instantiate class by name.

    See Also:
        :func:`symbol_by_name`.
    """
    return symbol_by_name(name)(*args, **kwargs)


@contextmanager
def cwd_in_path():
    """Context adding the current working directory to sys.path."""
    cwd = os.getcwd()
    if cwd in sys.path:
        yield
    else:
        sys.path.insert(0, cwd)
        try:
            yield cwd
        finally:
            try:
                sys.path.remove(cwd)
            except ValueError:  # pragma: no cover
                pass


def find_module(module, path=None, imp=None):
    """Version of :func:`imp.find_module` supporting dots."""
    if imp is None:
        imp = import_module
    with cwd_in_path():
        try:
            return imp(module)
        except ImportError:
            # Raise a more specific error if the problem is that one of the
            # dot-separated segments of the module name is not a package.
            if '.' in module:
                parts = module.split('.')
                for i, part in enumerate(parts[:-1]):
                    package = '.'.join(parts[:i + 1])
                    try:
                        mpart = imp(package)
                    except ImportError:
                        # Break out and re-raise the original ImportError
                        # instead.
                        break
                    try:
                        mpart.__path__
                    except AttributeError:
                        raise NotAPackage(package)
            raise


def import_from_cwd(module, imp=None, package=None):
    """Import module, temporarily including modules in the current directory.

    Modules located in the current directory has
    precedence over modules located in `sys.path`.
    """
    if imp is None:
        imp = import_module
    with cwd_in_path():
        return imp(module, package=package)


def reload_from_cwd(module, reloader=None):
    """Reload module (ensuring that CWD is in sys.path)."""
    if reloader is None:
        reloader = reload
    with cwd_in_path():
        return reloader(module)


def module_file(module):
    """Return the correct original file name of a module."""
    name = module.__file__
    return name[:-1] if name.endswith('.pyc') else name


def gen_task_name(app, name, module_name):
    """Generate task name from name/module pair."""
    module_name = module_name or '__main__'
    try:
        module = sys.modules[module_name]
    except KeyError:
        # Fix for manage.py shell_plus (Issue #366)
        module = None

    if module is not None:
        module_name = module.__name__
        # - If the task module is used as the __main__ script
        # - we need to rewrite the module part of the task name
        # - to match App.main.
        if MP_MAIN_FILE and module.__file__ == MP_MAIN_FILE:
            # - see comment about :envvar:`MP_MAIN_FILE` above.
            module_name = '__main__'
    if module_name == '__main__' and app.main:
        return '.'.join([app.main, name])
    return '.'.join(p for p in (module_name, name) if p)


def load_extension_class_names(namespace):
    if sys.version_info >= (3, 10):
        _entry_points = entry_points(group=namespace)
    else:
        try:
            _entry_points = entry_points().get(namespace, [])
        except AttributeError:
            _entry_points = entry_points().select(group=namespace)
    for ep in _entry_points:
        yield ep.name, ep.value


def load_extension_classes(namespace):
    for name, class_name in load_extension_class_names(namespace):
        try:
            cls = symbol_by_name(class_name)
        except (ImportError, SyntaxError) as exc:
            warnings.warn(
                f'Cannot load {namespace} extension {class_name!r}: {exc!r}')
        else:
            yield name, cls
