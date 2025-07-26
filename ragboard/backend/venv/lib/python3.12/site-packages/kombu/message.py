"""Message class."""

from __future__ import annotations

import sys

from .compression import decompress
from .exceptions import MessageStateError, reraise
from .serialization import loads
from .utils.functional import dictfilter

__all__ = ('Message',)

ACK_STATES = {'ACK', 'REJECTED', 'REQUEUED'}
IS_PYPY = hasattr(sys, 'pypy_version_info')


class Message:
    """Base class for received messages.

    Keyword Arguments:
    -----------------
        channel (ChannelT): If message was received, this should be the
            channel that the message was received on.

        body (str): Message body.

        delivery_mode (bool): Set custom delivery mode.
            Defaults to :attr:`delivery_mode`.

        priority (int): Message priority, 0 to broker configured
            max priority, where higher is better.

        content_type (str): The messages content_type.  If content_type
            is set, no serialization occurs as it is assumed this is either
            a binary object, or you've done your own serialization.
            Leave blank if using built-in serialization as our library
            properly sets content_type.

        content_encoding (str): The character set in which this object
            is encoded. Use "binary" if sending in raw binary objects.
            Leave blank if using built-in serialization as our library
            properly sets content_encoding.

        properties (Dict): Message properties.

        headers (Dict): Message headers.
    """

    MessageStateError = MessageStateError

    errors = None

    if not IS_PYPY:  # pragma: no cover
        __slots__ = (
            '_state', 'channel', 'delivery_tag',
            'content_type', 'content_encoding',
            'delivery_info', 'headers', 'properties',
            'body', '_decoded_cache', 'accept', '__dict__',
        )

    def __init__(self, body=None, delivery_tag=None,
                 content_type=None, content_encoding=None, delivery_info=None,
                 properties=None, headers=None, postencode=None,
                 accept=None, channel=None, **kwargs):
        delivery_info = {} if not delivery_info else delivery_info
        self.errors = [] if self.errors is None else self.errors
        self.channel = channel
        self.delivery_tag = delivery_tag
        self.content_type = content_type
        self.content_encoding = content_encoding
        self.delivery_info = delivery_info
        self.headers = headers or {}
        self.properties = properties or {}
        self._decoded_cache = None
        self._state = 'RECEIVED'
        self.accept = accept

        compression = self.headers.get('compression')
        if not self.errors and compression:
            try:
                body = decompress(body, compression)
            except Exception:
                self.errors.append(sys.exc_info())

        if not self.errors and postencode and isinstance(body, str):
            try:
                body = body.encode(postencode)
            except Exception:
                self.errors.append(sys.exc_info())
        self.body = body

    def _reraise_error(self, callback=None):
        try:
            reraise(*self.errors[0])
        except Exception as exc:
            if not callback:
                raise
            callback(self, exc)

    def ack(self, multiple=False):
        """Acknowledge this message as being processed.

        This will remove the message from the queue.

        Raises
        ------
            MessageStateError: If the message has already been
                acknowledged/requeued/rejected.
        """
        if self.channel is None:
            raise self.MessageStateError(
                'This message does not have a receiving channel')
        if self.channel.no_ack_consumers is not None:
            try:
                consumer_tag = self.delivery_info['consumer_tag']
            except KeyError:
                pass
            else:
                if consumer_tag in self.channel.no_ack_consumers:
                    return
        if self.acknowledged:
            raise self.MessageStateError(
                'Message already acknowledged with state: {0._state}'.format(
                    self))
        self.channel.basic_ack(self.delivery_tag, multiple=multiple)
        self._state = 'ACK'

    def ack_log_error(self, logger, errors, multiple=False):
        try:
            self.ack(multiple=multiple)
        except BrokenPipeError as exc:
            logger.critical("Couldn't ack %r, reason:%r",
                            self.delivery_tag, exc, exc_info=True)
            raise
        except errors as exc:
            logger.critical("Couldn't ack %r, reason:%r",
                            self.delivery_tag, exc, exc_info=True)

    def reject_log_error(self, logger, errors, requeue=False):
        try:
            self.reject(requeue=requeue)
        except errors as exc:
            logger.critical("Couldn't reject %r, reason: %r",
                            self.delivery_tag, exc, exc_info=True)

    def reject(self, requeue=False):
        """Reject this message.

        The message will be discarded by the server.

        Raises
        ------
            MessageStateError: If the message has already been
                acknowledged/requeued/rejected.
        """
        if self.channel is None:
            raise self.MessageStateError(
                'This message does not have a receiving channel')
        if self.acknowledged:
            raise self.MessageStateError(
                'Message already acknowledged with state: {0._state}'.format(
                    self))
        self.channel.basic_reject(self.delivery_tag, requeue=requeue)
        self._state = 'REJECTED'

    def requeue(self):
        """Reject this message and put it back on the queue.

        Warning:
        -------
            You must not use this method as a means of selecting messages
            to process.

        Raises
        ------
            MessageStateError: If the message has already been
                acknowledged/requeued/rejected.
        """
        if self.channel is None:
            raise self.MessageStateError(
                'This message does not have a receiving channel')
        if self.acknowledged:
            raise self.MessageStateError(
                'Message already acknowledged with state: {0._state}'.format(
                    self))
        self.channel.basic_reject(self.delivery_tag, requeue=True)
        self._state = 'REQUEUED'

    def decode(self):
        """Deserialize the message body.

        Returning the original python structure sent by the publisher.

        Note:
        ----
            The return value is memoized, use `_decode` to force
            re-evaluation.
        """
        if not self._decoded_cache:
            self._decoded_cache = self._decode()
        return self._decoded_cache

    def _decode(self):
        return loads(self.body, self.content_type,
                     self.content_encoding, accept=self.accept)

    @property
    def acknowledged(self):
        """Set to true if the message has been acknowledged."""
        return self._state in ACK_STATES

    @property
    def payload(self):
        """The decoded message body."""
        return self._decoded_cache if self._decoded_cache else self.decode()

    def __repr__(self):
        return '<{} object at {:#x} with details {!r}>'.format(
            type(self).__name__, id(self), dictfilter(
                state=self._state,
                content_type=self.content_type,
                delivery_tag=self.delivery_tag,
                body_length=len(self.body) if self.body is not None else None,
                properties=dictfilter(
                    correlation_id=self.properties.get('correlation_id'),
                    type=self.properties.get('type'),
                ),
                delivery_info=dictfilter(
                    exchange=self.delivery_info.get('exchange'),
                    routing_key=self.delivery_info.get('routing_key'),
                ),
            ),
        )
