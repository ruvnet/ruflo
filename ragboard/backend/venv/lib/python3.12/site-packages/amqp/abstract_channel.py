"""Code common to Connection and Channel objects."""
# Copyright (C) 2007-2008 Barry Pederson <bp@barryp.org>)

import logging

from vine import ensure_promise, promise

from .exceptions import AMQPNotImplementedError, RecoverableConnectionError
from .serialization import dumps, loads

__all__ = ('AbstractChannel',)

AMQP_LOGGER = logging.getLogger('amqp')

IGNORED_METHOD_DURING_CHANNEL_CLOSE = """\
Received method %s during closing channel %s. This method will be ignored\
"""


class AbstractChannel:
    """Superclass for Connection and Channel.

    The connection is treated as channel 0, then comes
    user-created channel objects.

    The subclasses must have a _METHOD_MAP class property, mapping
    between AMQP method signatures and Python methods.
    """

    def __init__(self, connection, channel_id):
        self.is_closing = False
        self.connection = connection
        self.channel_id = channel_id
        connection.channels[channel_id] = self
        self.method_queue = []  # Higher level queue for methods
        self.auto_decode = False
        self._pending = {}
        self._callbacks = {}

        self._setup_listeners()

    __slots__ = (
        "is_closing",
        "connection",
        "channel_id",
        "method_queue",
        "auto_decode",
        "_pending",
        "_callbacks",
        # adding '__dict__' to get dynamic assignment
        "__dict__",
        "__weakref__",
        )

    def __enter__(self):
        return self

    def __exit__(self, *exc_info):
        self.close()

    def send_method(self, sig,
                    format=None, args=None, content=None,
                    wait=None, callback=None, returns_tuple=False):
        p = promise()
        conn = self.connection
        if conn is None:
            raise RecoverableConnectionError('connection already closed')
        args = dumps(format, args) if format else ''
        try:
            conn.frame_writer(1, self.channel_id, sig, args, content)
        except StopIteration:
            raise RecoverableConnectionError('connection already closed')

        # TODO temp: callback should be after write_method ... ;)
        if callback:
            p.then(callback)
        p()
        if wait:
            return self.wait(wait, returns_tuple=returns_tuple)
        return p

    def close(self):
        """Close this Channel or Connection."""
        raise NotImplementedError('Must be overridden in subclass')

    def wait(self, method, callback=None, timeout=None, returns_tuple=False):
        p = ensure_promise(callback)
        pending = self._pending
        prev_p = []
        if not isinstance(method, list):
            method = [method]

        for m in method:
            prev_p.append(pending.get(m))
            pending[m] = p

        try:
            while not p.ready:
                self.connection.drain_events(timeout=timeout)

            if p.value:
                args, kwargs = p.value
                args = args[1:]  # We are not returning method back
                return args if returns_tuple else (args and args[0])
        finally:
            for i, m in enumerate(method):
                if prev_p[i] is not None:
                    pending[m] = prev_p[i]
                else:
                    pending.pop(m, None)

    def dispatch_method(self, method_sig, payload, content):
        if self.is_closing and method_sig not in (
            self._ALLOWED_METHODS_WHEN_CLOSING
        ):
            # When channel.close() was called we must ignore all methods except
            # Channel.close and Channel.CloseOk
            AMQP_LOGGER.warning(
                IGNORED_METHOD_DURING_CHANNEL_CLOSE,
                method_sig, self.channel_id
            )
            return

        if content and \
                self.auto_decode and \
                hasattr(content, 'content_encoding'):
            try:
                content.body = content.body.decode(content.content_encoding)
            except Exception:
                pass

        try:
            amqp_method = self._METHODS[method_sig]
        except KeyError:
            raise AMQPNotImplementedError(
                f'Unknown AMQP method {method_sig!r}')

        try:
            listeners = [self._callbacks[method_sig]]
        except KeyError:
            listeners = []
        one_shot = None
        try:
            one_shot = self._pending.pop(method_sig)
        except KeyError:
            if not listeners:
                return

        args = []
        if amqp_method.args:
            args, _ = loads(amqp_method.args, payload, 4)
        if amqp_method.content:
            args.append(content)

        for listener in listeners:
            listener(*args)

        if one_shot:
            one_shot(method_sig, *args)

    #: Placeholder, the concrete implementations will have to
    #: supply their own versions of _METHOD_MAP
    _METHODS = {}
