"""Object related utilities, including introspection, etc."""
from functools import reduce

__all__ = ('Bunch', 'FallbackContext', 'getitem_property', 'mro_lookup')


class Bunch:
    """Object that enables you to modify attributes."""

    def __init__(self, **kwargs):
        self.__dict__.update(kwargs)


def mro_lookup(cls, attr, stop=None, monkey_patched=None):
    """Return the first node by MRO order that defines an attribute.

    Arguments:
        cls (Any): Child class to traverse.
        attr (str): Name of attribute to find.
        stop (Set[Any]): A set of types that if reached will stop
            the search.
        monkey_patched (Sequence): Use one of the stop classes
            if the attributes module origin isn't in this list.
            Used to detect monkey patched attributes.

    Returns:
        Any: The attribute value, or :const:`None` if not found.
    """
    stop = set() if not stop else stop
    monkey_patched = [] if not monkey_patched else monkey_patched
    for node in cls.mro():
        if node in stop:
            try:
                value = node.__dict__[attr]
                module_origin = value.__module__
            except (AttributeError, KeyError):
                pass
            else:
                if module_origin not in monkey_patched:
                    return node
            return
        if attr in node.__dict__:
            return node


class FallbackContext:
    """Context workaround.

    The built-in ``@contextmanager`` utility does not work well
    when wrapping other contexts, as the traceback is wrong when
    the wrapped context raises.

    This solves this problem and can be used instead of ``@contextmanager``
    in this example::

        @contextmanager
        def connection_or_default_connection(connection=None):
            if connection:
                # user already has a connection, shouldn't close
                # after use
                yield connection
            else:
                # must've new connection, and also close the connection
                # after the block returns
                with create_new_connection() as connection:
                    yield connection

    This wrapper can be used instead for the above like this::

        def connection_or_default_connection(connection=None):
            return FallbackContext(connection, create_new_connection)
    """

    def __init__(self, provided, fallback, *fb_args, **fb_kwargs):
        self.provided = provided
        self.fallback = fallback
        self.fb_args = fb_args
        self.fb_kwargs = fb_kwargs
        self._context = None

    def __enter__(self):
        if self.provided is not None:
            return self.provided
        context = self._context = self.fallback(
            *self.fb_args, **self.fb_kwargs
        ).__enter__()
        return context

    def __exit__(self, *exc_info):
        if self._context is not None:
            return self._context.__exit__(*exc_info)


class getitem_property:
    """Attribute -> dict key descriptor.

    The target object must support ``__getitem__``,
    and optionally ``__setitem__``.

    Example:
        >>> from collections import defaultdict

        >>> class Me(dict):
        ...     deep = defaultdict(dict)
        ...
        ...     foo = _getitem_property('foo')
        ...     deep_thing = _getitem_property('deep.thing')


        >>> me = Me()
        >>> me.foo
        None

        >>> me.foo = 10
        >>> me.foo
        10
        >>> me['foo']
        10

        >>> me.deep_thing = 42
        >>> me.deep_thing
        42
        >>> me.deep
        defaultdict(<type 'dict'>, {'thing': 42})
    """

    def __init__(self, keypath, doc=None):
        path, _, self.key = keypath.rpartition('.')
        self.path = path.split('.') if path else None
        self.__doc__ = doc

    def _path(self, obj):
        return (reduce(lambda d, k: d[k], [obj] + self.path) if self.path
                else obj)

    def __get__(self, obj, type=None):
        if obj is None:
            return type
        return self._path(obj).get(self.key)

    def __set__(self, obj, value):
        self._path(obj)[self.key] = value
