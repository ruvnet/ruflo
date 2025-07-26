"""Exceptions."""

from __future__ import annotations

from socket import timeout as TimeoutError
from types import TracebackType
from typing import TYPE_CHECKING, TypeVar

from amqp import ChannelError, ConnectionError, ResourceError

if TYPE_CHECKING:
    from kombu.asynchronous.http import Response

__all__ = (
    'reraise', 'KombuError', 'OperationalError',
    'NotBoundError', 'MessageStateError', 'TimeoutError',
    'LimitExceeded', 'ConnectionLimitExceeded',
    'ChannelLimitExceeded', 'ConnectionError', 'ChannelError',
    'VersionMismatch', 'SerializerNotInstalled', 'ResourceError',
    'SerializationError', 'EncodeError', 'DecodeError', 'HttpError',
    'InconsistencyError',
)

BaseExceptionType = TypeVar('BaseExceptionType', bound=BaseException)


def reraise(
    tp: type[BaseExceptionType],
    value: BaseExceptionType,
    tb: TracebackType | None = None
) -> BaseExceptionType:
    """Reraise exception."""
    if value.__traceback__ is not tb:
        raise value.with_traceback(tb)
    raise value


class KombuError(Exception):
    """Common subclass for all Kombu exceptions."""


class OperationalError(KombuError):
    """Recoverable message transport connection error."""


class SerializationError(KombuError):
    """Failed to serialize/deserialize content."""


class EncodeError(SerializationError):
    """Cannot encode object."""


class DecodeError(SerializationError):
    """Cannot decode object."""


class NotBoundError(KombuError):
    """Trying to call channel dependent method on unbound entity."""


class MessageStateError(KombuError):
    """The message has already been acknowledged."""


class LimitExceeded(KombuError):
    """Limit exceeded."""


class ConnectionLimitExceeded(LimitExceeded):
    """Maximum number of simultaneous connections exceeded."""


class ChannelLimitExceeded(LimitExceeded):
    """Maximum number of simultaneous channels exceeded."""


class VersionMismatch(KombuError):
    """Library dependency version mismatch."""


class SerializerNotInstalled(KombuError):
    """Support for the requested serialization type is not installed."""


class ContentDisallowed(SerializerNotInstalled):
    """Consumer does not allow this content-type."""


class InconsistencyError(ConnectionError):
    """Data or environment has been found to be inconsistent.

    Depending on the cause it may be possible to retry the operation.
    """


class HttpError(Exception):
    """HTTP Client Error."""

    def __init__(
        self,
        code: int,
        message: str | None = None,
        response: Response | None = None
    ) -> None:
        self.code = code
        self.message = message
        self.response = response
        super().__init__(code, message, response)

    def __str__(self) -> str:
        return 'HTTP {0.code}: {0.message}'.format(self)
