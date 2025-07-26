"""Scheduler for Python functions.

.. note::
    This is used for the thread-based worker only,
    not for amqp/redis/sqs/qpid where :mod:`kombu.asynchronous.timer` is used.
"""
import os
import sys
import threading
from itertools import count
from threading import TIMEOUT_MAX as THREAD_TIMEOUT_MAX
from time import sleep

from kombu.asynchronous.timer import Entry
from kombu.asynchronous.timer import Timer as Schedule
from kombu.asynchronous.timer import logger, to_timestamp

TIMER_DEBUG = os.environ.get('TIMER_DEBUG')

__all__ = ('Entry', 'Schedule', 'Timer', 'to_timestamp')


class Timer(threading.Thread):
    """Timer thread.

    Note:
        This is only used for transports not supporting AsyncIO.
    """

    Entry = Entry
    Schedule = Schedule

    running = False
    on_tick = None

    _timer_count = count(1)

    if TIMER_DEBUG:  # pragma: no cover
        def start(self, *args, **kwargs):
            import traceback
            print('- Timer starting')
            traceback.print_stack()
            super().start(*args, **kwargs)

    def __init__(self, schedule=None, on_error=None, on_tick=None,
                 on_start=None, max_interval=None, **kwargs):
        self.schedule = schedule or self.Schedule(on_error=on_error,
                                                  max_interval=max_interval)
        self.on_start = on_start
        self.on_tick = on_tick or self.on_tick
        super().__init__()
        # `_is_stopped` is likely to be an attribute on `Thread` objects so we
        # double underscore these names to avoid shadowing anything and
        # potentially getting confused by the superclass turning these into
        # something other than an `Event` instance (e.g. a `bool`)
        self.__is_shutdown = threading.Event()
        self.__is_stopped = threading.Event()
        self.mutex = threading.Lock()
        self.not_empty = threading.Condition(self.mutex)
        self.daemon = True
        self.name = f'Timer-{next(self._timer_count)}'

    def _next_entry(self):
        with self.not_empty:
            delay, entry = next(self.scheduler)
            if entry is None:
                if delay is None:
                    self.not_empty.wait(1.0)
                return delay
        return self.schedule.apply_entry(entry)
    __next__ = next = _next_entry  # for 2to3

    def run(self):
        try:
            self.running = True
            self.scheduler = iter(self.schedule)

            while not self.__is_shutdown.is_set():
                delay = self._next_entry()
                if delay:
                    if self.on_tick:
                        self.on_tick(delay)
                    if sleep is None:  # pragma: no cover
                        break
                    sleep(delay)
            try:
                self.__is_stopped.set()
            except TypeError:  # pragma: no cover
                # we lost the race at interpreter shutdown,
                # so gc collected built-in modules.
                pass
        except Exception as exc:
            logger.error('Thread Timer crashed: %r', exc, exc_info=True)
            sys.stderr.flush()
            os._exit(1)

    def stop(self):
        self.__is_shutdown.set()
        if self.running:
            self.__is_stopped.wait()
            self.join(THREAD_TIMEOUT_MAX)
            self.running = False

    def ensure_started(self):
        if not self.running and not self.is_alive():
            if self.on_start:
                self.on_start(self)
            self.start()

    def _do_enter(self, meth, *args, **kwargs):
        self.ensure_started()
        with self.mutex:
            entry = getattr(self.schedule, meth)(*args, **kwargs)
            self.not_empty.notify()
            return entry

    def enter(self, entry, eta, priority=None):
        return self._do_enter('enter_at', entry, eta, priority=priority)

    def call_at(self, *args, **kwargs):
        return self._do_enter('call_at', *args, **kwargs)

    def enter_after(self, *args, **kwargs):
        return self._do_enter('enter_after', *args, **kwargs)

    def call_after(self, *args, **kwargs):
        return self._do_enter('call_after', *args, **kwargs)

    def call_repeatedly(self, *args, **kwargs):
        return self._do_enter('call_repeatedly', *args, **kwargs)

    def exit_after(self, secs, priority=10):
        self.call_after(secs, sys.exit, priority)

    def cancel(self, tref):
        tref.cancel()

    def clear(self):
        self.schedule.clear()

    def empty(self):
        return not len(self)

    def __len__(self):
        return len(self.schedule)

    def __bool__(self):
        """``bool(timer)``."""
        return True
    __nonzero__ = __bool__

    @property
    def queue(self):
        return self.schedule.queue
