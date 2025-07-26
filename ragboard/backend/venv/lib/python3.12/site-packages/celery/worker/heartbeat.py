"""Heartbeat service.

This is the internal thread responsible for sending heartbeat events
at regular intervals (may not be an actual thread).
"""
from celery.signals import heartbeat_sent
from celery.utils.sysinfo import load_average

from .state import SOFTWARE_INFO, active_requests, all_total_count

__all__ = ('Heart',)


class Heart:
    """Timer sending heartbeats at regular intervals.

    Arguments:
        timer (kombu.asynchronous.timer.Timer): Timer to use.
        eventer (celery.events.EventDispatcher): Event dispatcher
            to use.
        interval (float): Time in seconds between sending
            heartbeats.  Default is 2 seconds.
    """

    def __init__(self, timer, eventer, interval=None):
        self.timer = timer
        self.eventer = eventer
        self.interval = float(interval or 2.0)
        self.tref = None

        # Make event dispatcher start/stop us when enabled/disabled.
        self.eventer.on_enabled.add(self.start)
        self.eventer.on_disabled.add(self.stop)

        # Only send heartbeat_sent signal if it has receivers.
        self._send_sent_signal = (
            heartbeat_sent.send if heartbeat_sent.receivers else None)

    def _send(self, event, retry=True):
        if self._send_sent_signal is not None:
            self._send_sent_signal(sender=self)
        return self.eventer.send(event, freq=self.interval,
                                 active=len(active_requests),
                                 processed=all_total_count[0],
                                 loadavg=load_average(),
                                 retry=retry,
                                 **SOFTWARE_INFO)

    def start(self):
        if self.eventer.enabled:
            self._send('worker-online')
            self.tref = self.timer.call_repeatedly(
                self.interval, self._send, ('worker-heartbeat',),
            )

    def stop(self):
        if self.tref is not None:
            self.timer.cancel(self.tref)
            self.tref = None
        if self.eventer.enabled:
            self._send('worker-offline', retry=False)
