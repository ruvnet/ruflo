"""Worker Event Heartbeat Bootstep."""
from celery import bootsteps
from celery.worker import heartbeat

from .events import Events

__all__ = ('Heart',)


class Heart(bootsteps.StartStopStep):
    """Bootstep sending event heartbeats.

    This service sends a ``worker-heartbeat`` message every n seconds.

    Note:
        Not to be confused with AMQP protocol level heartbeats.
    """

    requires = (Events,)

    def __init__(self, c,
                 without_heartbeat=False, heartbeat_interval=None, **kwargs):
        self.enabled = not without_heartbeat
        self.heartbeat_interval = heartbeat_interval
        c.heart = None
        super().__init__(c, **kwargs)

    def start(self, c):
        c.heart = heartbeat.Heart(
            c.timer, c.event_dispatcher, self.heartbeat_interval,
        )
        c.heart.start()

    def stop(self, c):
        c.heart = c.heart and c.heart.stop()
    shutdown = stop
