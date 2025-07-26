"""Proxy/PromiseProxy implementation.

This module contains critical utilities that needs to be loaded as
soon as possible, and that shall not load any third party modules.

Parts of this module is Copyright by Werkzeug Team.
"""

import operator
import sys
from functools import reduce
from importlib import import_module
from types import ModuleType

__all__ = ('Proxy', 'PromiseProxy', 'try_import', 'maybe_evaluate')

__module__ = __name__  # used by Proxy class body


def _default_cls_attr(name, type_, cls_value):
    # Proxy uses properties to forward the standard
    # class attributes __module__, __name__ and __doc__ to the real
    # object, but these needs to be a string when accessed from
    # the Proxy class directly.  This is a hack to make that work.
    # -- See Issue #1087.

    def __new__(cls, getter):
        instance = type_.__new__(cls, cls_value)
        instance.__getter = getter
        return instance

    def __get__(self, obj, cls=None):
        return self.__getter(obj) if obj is not None else self

    return type(name, (type_,), {
        '__new__': __new__, '__get__': __get__,
    })


def try_import(module, default=None):
    """Try to import and return module.

    Returns None if the module does not exist.
    """
    try:
        return import_module(module)
    except ImportError:
        return default


class Proxy:
    """Proxy to another object."""

    # Code stolen from werkzeug.local.Proxy.
    __slots__ = ('__local', '__args', '__kwargs', '__dict__')

    def __init__(self, local,
                 args=None, kwargs=None, name=None, __doc__=None):
        object.__setattr__(self, '_Proxy__local', local)
        object.__setattr__(self, '_Proxy__args', args or ())
        object.__setattr__(self, '_Proxy__kwargs', kwargs or {})
        if name is not None:
            object.__setattr__(self, '__custom_name__', name)
        if __doc__ is not None:
            object.__setattr__(self, '__doc__', __doc__)

    @_default_cls_attr('name', str, __name__)
    def __name__(self):
        try:
            return self.__custom_name__
        except AttributeError:
            return self._get_current_object().__name__

    @_default_cls_attr('qualname', str, __name__)
    def __qualname__(self):
        try:
            return self.__custom_name__
        except AttributeError:
            return self._get_current_object().__qualname__

    @_default_cls_attr('module', str, __module__)
    def __module__(self):
        return self._get_current_object().__module__

    @_default_cls_attr('doc', str, __doc__)
    def __doc__(self):
        return self._get_current_object().__doc__

    def _get_class(self):
        return self._get_current_object().__class__

    @property
    def __class__(self):
        return self._get_class()

    def _get_current_object(self):
        """Get current object.

        This is useful if you want the real
        object behind the proxy at a time for performance reasons or because
        you want to pass the object into a different context.
        """
        loc = object.__getattribute__(self, '_Proxy__local')
        if not hasattr(loc, '__release_local__'):
            return loc(*self.__args, **self.__kwargs)
        try:  # pragma: no cover
            # not sure what this is about
            return getattr(loc, self.__name__)
        except AttributeError:  # pragma: no cover
            raise RuntimeError(f'no object bound to {self.__name__}')

    @property
    def __dict__(self):
        try:
            return self._get_current_object().__dict__
        except RuntimeError:  # pragma: no cover
            raise AttributeError('__dict__')

    def __repr__(self):
        try:
            obj = self._get_current_object()
        except RuntimeError:  # pragma: no cover
            return f'<{self.__class__.__name__} unbound>'
        return repr(obj)

    def __bool__(self):
        try:
            return bool(self._get_current_object())
        except RuntimeError:  # pragma: no cover
            return False

    __nonzero__ = __bool__  # Py2

    def __dir__(self):
        try:
            return dir(self._get_current_object())
        except RuntimeError:  # pragma: no cover
            return []

    def __getattr__(self, name):
        if name == '__members__':
            return dir(self._get_current_object())
        return getattr(self._get_current_object(), name)

    def __setitem__(self, key, value):
        self._get_current_object()[key] = value

    def __delitem__(self, key):
        del self._get_current_object()[key]

    def __setattr__(self, name, value):
        setattr(self._get_current_object(), name, value)

    def __delattr__(self, name):
        delattr(self._get_current_object(), name)

    def __str__(self):
        return str(self._get_current_object())

    def __lt__(self, other):
        return self._get_current_object() < other

    def __le__(self, other):
        return self._get_current_object() <= other

    def __eq__(self, other):
        return self._get_current_object() == other

    def __ne__(self, other):
        return self._get_current_object() != other

    def __gt__(self, other):
        return self._get_current_object() > other

    def __ge__(self, other):
        return self._get_current_object() >= other

    def __hash__(self):
        return hash(self._get_current_object())

    def __call__(self, *a, **kw):
        return self._get_current_object()(*a, **kw)

    def __len__(self):
        return len(self._get_current_object())

    def __getitem__(self, i):
        return self._get_current_object()[i]

    def __iter__(self):
        return iter(self._get_current_object())

    def __contains__(self, i):
        return i in self._get_current_object()

    def __add__(self, other):
        return self._get_current_object() + other

    def __sub__(self, other):
        return self._get_current_object() - other

    def __mul__(self, other):
        return self._get_current_object() * other

    def __floordiv__(self, other):
        return self._get_current_object() // other

    def __mod__(self, other):
        return self._get_current_object() % other

    def __divmod__(self, other):
        return self._get_current_object().__divmod__(other)

    def __pow__(self, other):
        return self._get_current_object() ** other

    def __lshift__(self, other):
        return self._get_current_object() << other

    def __rshift__(self, other):
        return self._get_current_object() >> other

    def __and__(self, other):
        return self._get_current_object() & other

    def __xor__(self, other):
        return self._get_current_object() ^ other

    def __or__(self, other):
        return self._get_current_object() | other

    def __div__(self, other):
        return self._get_current_object().__div__(other)

    def __truediv__(self, other):
        return self._get_current_object().__truediv__(other)

    def __neg__(self):
        return -(self._get_current_object())

    def __pos__(self):
        return +(self._get_current_object())

    def __abs__(self):
        return abs(self._get_current_object())

    def __invert__(self):
        return ~(self._get_current_object())

    def __complex__(self):
        return complex(self._get_current_object())

    def __int__(self):
        return int(self._get_current_object())

    def __float__(self):
        return float(self._get_current_object())

    def __oct__(self):
        return oct(self._get_current_object())

    def __hex__(self):
        return hex(self._get_current_object())

    def __index__(self):
        return self._get_current_object().__index__()

    def __coerce__(self, other):
        return self._get_current_object().__coerce__(other)

    def __enter__(self):
        return self._get_current_object().__enter__()

    def __exit__(self, *a, **kw):
        return self._get_current_object().__exit__(*a, **kw)

    def __reduce__(self):
        return self._get_current_object().__reduce__()


class PromiseProxy(Proxy):
    """Proxy that evaluates object once.

    :class:`Proxy` will evaluate the object each time, while the
    promise will only evaluate it once.
    """

    __slots__ = ('__pending__', '__weakref__')

    def _get_current_object(self):
        try:
            return object.__getattribute__(self, '__thing')
        except AttributeError:
            return self.__evaluate__()

    def __then__(self, fun, *args, **kwargs):
        if self.__evaluated__():
            return fun(*args, **kwargs)
        from collections import deque
        try:
            pending = object.__getattribute__(self, '__pending__')
        except AttributeError:
            pending = None
        if pending is None:
            pending = deque()
            object.__setattr__(self, '__pending__', pending)
        pending.append((fun, args, kwargs))

    def __evaluated__(self):
        try:
            object.__getattribute__(self, '__thing')
        except AttributeError:
            return False
        return True

    def __maybe_evaluate__(self):
        return self._get_current_object()

    def __evaluate__(self,
                     _clean=('_Proxy__local',
                             '_Proxy__args',
                             '_Proxy__kwargs')):
        try:
            thing = Proxy._get_current_object(self)
        except Exception:
            raise
        else:
            object.__setattr__(self, '__thing', thing)
            for attr in _clean:
                try:
                    object.__delattr__(self, attr)
                except AttributeError:  # pragma: no cover
                    # May mask errors so ignore
                    pass
            try:
                pending = object.__getattribute__(self, '__pending__')
            except AttributeError:
                pass
            else:
                try:
                    while pending:
                        fun, args, kwargs = pending.popleft()
                        fun(*args, **kwargs)
                finally:
                    try:
                        object.__delattr__(self, '__pending__')
                    except AttributeError:  # pragma: no cover
                        pass
            return thing


def maybe_evaluate(obj):
    """Attempt to evaluate promise, even if obj is not a promise."""
    try:
        return obj.__maybe_evaluate__()
    except AttributeError:
        return obj


#  ############# Module Generation ##########################

# Utilities to dynamically
# recreate modules, either for lazy loading or
# to create old modules at runtime instead of
# having them litter the source tree.

# import fails in python 2.5. fallback to reduce in stdlib


MODULE_DEPRECATED = """
The module %s is deprecated and will be removed in a future version.
"""

DEFAULT_ATTRS = {'__file__', '__path__', '__doc__', '__all__'}


# im_func is no longer available in Py3.
# instead the unbound method itself can be used.
def fun_of_method(method):
    return method


def getappattr(path):
    """Get attribute from current_app recursively.

    Example: ``getappattr('amqp.get_task_consumer')``.

    """
    from celery import current_app
    return current_app._rgetattr(path)


COMPAT_MODULES = {
    'celery': {
        'execute': {
            'send_task': 'send_task',
        },
        'log': {
            'get_default_logger': 'log.get_default_logger',
            'setup_logger': 'log.setup_logger',
            'setup_logging_subsystem': 'log.setup_logging_subsystem',
            'redirect_stdouts_to_logger': 'log.redirect_stdouts_to_logger',
        },
        'messaging': {
            'TaskConsumer': 'amqp.TaskConsumer',
            'establish_connection': 'connection',
            'get_consumer_set': 'amqp.TaskConsumer',
        },
        'registry': {
            'tasks': 'tasks',
        },
    },
}

#: We exclude these from dir(celery)
DEPRECATED_ATTRS = set(COMPAT_MODULES['celery'].keys()) | {'subtask'}


class class_property:

    def __init__(self, getter=None, setter=None):
        if getter is not None and not isinstance(getter, classmethod):
            getter = classmethod(getter)
        if setter is not None and not isinstance(setter, classmethod):
            setter = classmethod(setter)
        self.__get = getter
        self.__set = setter

        info = getter.__get__(object)  # just need the info attrs.
        self.__doc__ = info.__doc__
        self.__name__ = info.__name__
        self.__module__ = info.__module__

    def __get__(self, obj, type=None):
        if obj and type is None:
            type = obj.__class__
        return self.__get.__get__(obj, type)()

    def __set__(self, obj, value):
        if obj is None:
            return self
        return self.__set.__get__(obj)(value)

    def setter(self, setter):
        return self.__class__(self.__get, setter)


def reclassmethod(method):
    return classmethod(fun_of_method(method))


class LazyModule(ModuleType):
    _compat_modules = ()
    _all_by_module = {}
    _direct = {}
    _object_origins = {}

    def __getattr__(self, name):
        if name in self._object_origins:
            module = __import__(self._object_origins[name], None, None,
                                [name])
            for item in self._all_by_module[module.__name__]:
                setattr(self, item, getattr(module, item))
            return getattr(module, name)
        elif name in self._direct:  # pragma: no cover
            module = __import__(self._direct[name], None, None, [name])
            setattr(self, name, module)
            return module
        return ModuleType.__getattribute__(self, name)

    def __dir__(self):
        return [
            attr for attr in set(self.__all__) | DEFAULT_ATTRS
            if attr not in DEPRECATED_ATTRS
        ]

    def __reduce__(self):
        return import_module, (self.__name__,)


def create_module(name, attrs, cls_attrs=None, pkg=None,
                  base=LazyModule, prepare_attr=None):
    fqdn = '.'.join([pkg.__name__, name]) if pkg else name
    cls_attrs = {} if cls_attrs is None else cls_attrs
    pkg, _, modname = name.rpartition('.')
    cls_attrs['__module__'] = pkg

    attrs = {
        attr_name: (prepare_attr(attr) if prepare_attr else attr)
        for attr_name, attr in attrs.items()
    }
    module = sys.modules[fqdn] = type(
        modname, (base,), cls_attrs)(name)
    module.__dict__.update(attrs)
    return module


def recreate_module(name, compat_modules=None, by_module=None, direct=None,
                    base=LazyModule, **attrs):
    compat_modules = compat_modules or COMPAT_MODULES.get(name, ())
    by_module = by_module or {}
    direct = direct or {}
    old_module = sys.modules[name]
    origins = get_origins(by_module)

    _all = tuple(set(reduce(
        operator.add,
        [tuple(v) for v in [compat_modules, origins, direct, attrs]],
    )))
    cattrs = {
        '_compat_modules': compat_modules,
        '_all_by_module': by_module, '_direct': direct,
        '_object_origins': origins,
        '__all__': _all,
    }
    new_module = create_module(name, attrs, cls_attrs=cattrs, base=base)
    new_module.__dict__.update({
        mod: get_compat_module(new_module, mod) for mod in compat_modules
    })
    new_module.__spec__ = old_module.__spec__
    return old_module, new_module


def get_compat_module(pkg, name):
    def prepare(attr):
        if isinstance(attr, str):
            return Proxy(getappattr, (attr,))
        return attr

    attrs = COMPAT_MODULES[pkg.__name__][name]
    if isinstance(attrs, str):
        fqdn = '.'.join([pkg.__name__, name])
        module = sys.modules[fqdn] = import_module(attrs)
        return module
    attrs['__all__'] = list(attrs)
    return create_module(name, dict(attrs), pkg=pkg, prepare_attr=prepare)


def get_origins(defs):
    origins = {}
    for module, attrs in defs.items():
        origins.update({attr: module for attr in attrs})
    return origins
