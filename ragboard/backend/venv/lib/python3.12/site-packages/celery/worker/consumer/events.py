"""Worker Event Dispatcher Bootstep.

``Events`` -> :class:`celery.events.EventDispatcher`.
"""
from kombu.common import ignore_errors

from celery import bootsteps

from .connection import Connection

__all__ = ('Events',)


class Events(bootsteps.StartStopStep):
    """Service used for sending monitoring events."""

    requires = (Connection,)

    def __init__(self, c,
                 task_events=True,
                 without_heartbeat=False,
                 without_gossip=False,
                 **kwargs):
        self.groups = None if task_events else ['worker']
        self.send_events = (
            task_events or
            not without_gossip or
            not without_heartbeat
        )
        self.enabled = self.send_events
        c.event_dispatcher = None
        super().__init__(c, **kwargs)

    def start(self, c):
        # flush events sent while connection was down.
        prev = self._close(c)
        dis = c.event_dispatcher = c.app.events.Dispatcher(
            c.connection_for_write(),
            hostname=c.hostname,
            enabled=self.send_events,
            groups=self.groups,
            # we currently only buffer events when the event loop is enabled
            # XXX This excludes eventlet/gevent, which should actually buffer.
            buffer_group=['task'] if c.hub else None,
            on_send_buffered=c.on_send_event_buffered if c.hub else None,
        )
        if prev:
            dis.extend_buffer(prev)
            dis.flush()

    def stop(self, c):
        pass

    def _close(self, c):
        if c.event_dispatcher:
            dispatcher = c.event_dispatcher
            # remember changes from remote control commands:
            self.groups = dispatcher.groups

            # close custom connection
            if dispatcher.connection:
                ignore_errors(c, dispatcher.connection.close)
            ignore_errors(c, dispatcher.close)
            c.event_dispatcher = None
            return dispatcher

    def shutdown(self, c):
        self._close(c)
