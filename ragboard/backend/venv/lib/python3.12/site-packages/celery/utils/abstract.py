"""Abstract classes."""
from abc import ABCMeta, abstractmethod
from collections.abc import Callable

__all__ = ('CallableTask', 'CallableSignature')


def _hasattr(C, attr):
    return any(attr in B.__dict__ for B in C.__mro__)


class _AbstractClass(metaclass=ABCMeta):
    __required_attributes__ = frozenset()

    @classmethod
    def _subclasshook_using(cls, parent, C):
        return (
            cls is parent and
            all(_hasattr(C, attr) for attr in cls.__required_attributes__)
        ) or NotImplemented

    @classmethod
    def register(cls, other):
        # we override `register` to return other for use as a decorator.
        type(cls).register(cls, other)
        return other


class CallableTask(_AbstractClass, Callable):  # pragma: no cover
    """Task interface."""

    __required_attributes__ = frozenset({
        'delay', 'apply_async', 'apply',
    })

    @abstractmethod
    def delay(self, *args, **kwargs):
        pass

    @abstractmethod
    def apply_async(self, *args, **kwargs):
        pass

    @abstractmethod
    def apply(self, *args, **kwargs):
        pass

    @classmethod
    def __subclasshook__(cls, C):
        return cls._subclasshook_using(CallableTask, C)


class CallableSignature(CallableTask):  # pragma: no cover
    """Celery Signature interface."""

    __required_attributes__ = frozenset({
        'clone', 'freeze', 'set', 'link', 'link_error', '__or__',
    })

    @property
    @abstractmethod
    def name(self):
        pass

    @property
    @abstractmethod
    def type(self):
        pass

    @property
    @abstractmethod
    def app(self):
        pass

    @property
    @abstractmethod
    def id(self):
        pass

    @property
    @abstractmethod
    def task(self):
        pass

    @property
    @abstractmethod
    def args(self):
        pass

    @property
    @abstractmethod
    def kwargs(self):
        pass

    @property
    @abstractmethod
    def options(self):
        pass

    @property
    @abstractmethod
    def subtask_type(self):
        pass

    @property
    @abstractmethod
    def chord_size(self):
        pass

    @property
    @abstractmethod
    def immutable(self):
        pass

    @abstractmethod
    def clone(self, args=None, kwargs=None):
        pass

    @abstractmethod
    def freeze(self, id=None, group_id=None, chord=None, root_id=None,
               group_index=None):
        pass

    @abstractmethod
    def set(self, immutable=None, **options):
        pass

    @abstractmethod
    def link(self, callback):
        pass

    @abstractmethod
    def link_error(self, errback):
        pass

    @abstractmethod
    def __or__(self, other):
        pass

    @abstractmethod
    def __invert__(self):
        pass

    @classmethod
    def __subclasshook__(cls, C):
        return cls._subclasshook_using(CallableSignature, C)
