"""Worker Pidbox (remote control)."""
import socket
import threading

from kombu.common import ignore_errors
from kombu.utils.encoding import safe_str

from celery.utils.collections import AttributeDict
from celery.utils.functional import pass1
from celery.utils.log import get_logger

from . import control

__all__ = ('Pidbox', 'gPidbox')

logger = get_logger(__name__)
debug, error, info = logger.debug, logger.error, logger.info


class Pidbox:
    """Worker mailbox."""

    consumer = None

    def __init__(self, c):
        self.c = c
        self.hostname = c.hostname
        self.node = c.app.control.mailbox.Node(
            safe_str(c.hostname),
            handlers=control.Panel.data,
            state=AttributeDict(
                app=c.app,
                hostname=c.hostname,
                consumer=c,
                tset=pass1 if c.controller.use_eventloop else set),
        )
        self._forward_clock = self.c.app.clock.forward

    def on_message(self, body, message):
        # just increase clock as clients usually don't
        # have a valid clock to adjust with.
        self._forward_clock()
        try:
            self.node.handle_message(body, message)
        except KeyError as exc:
            error('No such control command: %s', exc)
        except Exception as exc:
            error('Control command error: %r', exc, exc_info=True)
            self.reset()

    def start(self, c):
        self.node.channel = c.connection.channel()
        self.consumer = self.node.listen(callback=self.on_message)
        self.consumer.on_decode_error = c.on_decode_error

    def on_stop(self):
        pass

    def stop(self, c):
        self.on_stop()
        self.consumer = self._close_channel(c)

    def reset(self):
        self.stop(self.c)
        self.start(self.c)

    def _close_channel(self, c):
        if self.node and self.node.channel:
            ignore_errors(c, self.node.channel.close)

    def shutdown(self, c):
        self.on_stop()
        if self.consumer:
            debug('Canceling broadcast consumer...')
            ignore_errors(c, self.consumer.cancel)
        self.stop(self.c)


class gPidbox(Pidbox):
    """Worker pidbox (greenlet)."""

    _node_shutdown = None
    _node_stopped = None
    _resets = 0

    def start(self, c):
        c.pool.spawn_n(self.loop, c)

    def on_stop(self):
        if self._node_stopped:
            self._node_shutdown.set()
            debug('Waiting for broadcast thread to shutdown...')
            self._node_stopped.wait()
            self._node_stopped = self._node_shutdown = None

    def reset(self):
        self._resets += 1

    def _do_reset(self, c, connection):
        self._close_channel(c)
        self.node.channel = connection.channel()
        self.consumer = self.node.listen(callback=self.on_message)
        self.consumer.consume()

    def loop(self, c):
        resets = [self._resets]
        shutdown = self._node_shutdown = threading.Event()
        stopped = self._node_stopped = threading.Event()
        try:
            with c.connection_for_read() as connection:
                info('pidbox: Connected to %s.', connection.as_uri())
                self._do_reset(c, connection)
                while not shutdown.is_set() and c.connection:
                    if resets[0] < self._resets:
                        resets[0] += 1
                        self._do_reset(c, connection)
                    try:
                        connection.drain_events(timeout=1.0)
                    except socket.timeout:
                        pass
        finally:
            stopped.set()
