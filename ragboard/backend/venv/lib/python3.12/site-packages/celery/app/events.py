"""Implementation for the app.events shortcuts."""
from contextlib import contextmanager

from kombu.utils.objects import cached_property


class Events:
    """Implements app.events."""

    receiver_cls = 'celery.events.receiver:EventReceiver'
    dispatcher_cls = 'celery.events.dispatcher:EventDispatcher'
    state_cls = 'celery.events.state:State'

    def __init__(self, app=None):
        self.app = app

    @cached_property
    def Receiver(self):
        return self.app.subclass_with_self(
            self.receiver_cls, reverse='events.Receiver')

    @cached_property
    def Dispatcher(self):
        return self.app.subclass_with_self(
            self.dispatcher_cls, reverse='events.Dispatcher')

    @cached_property
    def State(self):
        return self.app.subclass_with_self(
            self.state_cls, reverse='events.State')

    @contextmanager
    def default_dispatcher(self, hostname=None, enabled=True,
                           buffer_while_offline=False):
        with self.app.amqp.producer_pool.acquire(block=True) as prod:
            # pylint: disable=too-many-function-args
            # This is a property pylint...
            with self.Dispatcher(prod.connection, hostname, enabled,
                                 prod.channel, buffer_while_offline) as d:
                yield d
