"""Object utilities."""

from __future__ import annotations

from copy import copy
from typing import TYPE_CHECKING, Any, Callable, TypeVar

from .connection import maybe_channel
from .exceptions import NotBoundError
from .utils.functional import ChannelPromise

if TYPE_CHECKING:
    from kombu.connection import Connection
    from kombu.transport.virtual import Channel


__all__ = ('Object', 'MaybeChannelBound')

_T = TypeVar("_T")
_ObjectType = TypeVar("_ObjectType", bound="Object")
_MaybeChannelBoundType = TypeVar(
    "_MaybeChannelBoundType", bound="MaybeChannelBound"
)


def unpickle_dict(
    cls: type[_ObjectType], kwargs: dict[str, Any]
) -> _ObjectType:
    return cls(**kwargs)


def _any(v: _T) -> _T:
    return v


class Object:
    """Common base class.

    Supports automatic kwargs->attributes handling, and cloning.
    """

    attrs: tuple[tuple[str, Any], ...] = ()

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        for name, type_ in self.attrs:
            value = kwargs.get(name)
            if value is not None:
                setattr(self, name, (type_ or _any)(value))
            else:
                try:
                    getattr(self, name)
                except AttributeError:
                    setattr(self, name, None)

    def as_dict(self, recurse: bool = False) -> dict[str, Any]:
        def f(obj: Any, type: Callable[[Any], Any] | None = None) -> Any:
            if recurse and isinstance(obj, Object):
                return obj.as_dict(recurse=True)
            return type(obj) if type and obj is not None else obj
        return {
            attr: f(getattr(self, attr), type) for attr, type in self.attrs
        }

    def __reduce__(self: _ObjectType) -> tuple[
        Callable[[type[_ObjectType], dict[str, Any]], _ObjectType],
        tuple[type[_ObjectType], dict[str, Any]]
    ]:
        return unpickle_dict, (self.__class__, self.as_dict())

    def __copy__(self: _ObjectType) -> _ObjectType:
        return self.__class__(**self.as_dict())


class MaybeChannelBound(Object):
    """Mixin for classes that can be bound to an AMQP channel."""

    _channel: Channel | None = None
    _is_bound = False

    #: Defines whether maybe_declare can skip declaring this entity twice.
    can_cache_declaration = False

    def __call__(
        self: _MaybeChannelBoundType, channel: (Channel | Connection)
    ) -> _MaybeChannelBoundType:
        """`self(channel) -> self.bind(channel)`."""
        return self.bind(channel)

    def bind(
        self: _MaybeChannelBoundType, channel: (Channel | Connection)
    ) -> _MaybeChannelBoundType:
        """Create copy of the instance that is bound to a channel."""
        return copy(self).maybe_bind(channel)

    def maybe_bind(
        self: _MaybeChannelBoundType, channel: (Channel | Connection)
    ) -> _MaybeChannelBoundType:
        """Bind instance to channel if not already bound."""
        if not self.is_bound and channel:
            self._channel = maybe_channel(channel)
            self.when_bound()
            self._is_bound = True
        return self

    def revive(self, channel: Channel) -> None:
        """Revive channel after the connection has been re-established.

        Used by :meth:`~kombu.Connection.ensure`.

        """
        if self.is_bound:
            self._channel = channel
            self.when_bound()

    def when_bound(self) -> None:
        """Callback called when the class is bound."""

    def __repr__(self) -> str:
        return self._repr_entity(type(self).__name__)

    def _repr_entity(self, item: str = '') -> str:
        item = item or type(self).__name__
        if self.is_bound:
            return '<{} bound to chan:{}>'.format(
                item or type(self).__name__, self.channel.channel_id)
        return f'<unbound {item}>'

    @property
    def is_bound(self) -> bool:
        """Flag set if the channel is bound."""
        return self._is_bound and self._channel is not None

    @property
    def channel(self) -> Channel:
        """Current channel if the object is bound."""
        channel = self._channel
        if channel is None:
            raise NotBoundError(
                "Can't call method on {} not bound to a channel".format(
                    type(self).__name__))
        if isinstance(channel, ChannelPromise):
            channel = self._channel = channel()
        return channel
