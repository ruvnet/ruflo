"""Timer scheduling Python callbacks."""

from __future__ import annotations

import heapq
import sys
from collections import namedtuple
from datetime import datetime
from functools import total_ordering
from time import monotonic
from time import time as _time
from typing import TYPE_CHECKING
from weakref import proxy as weakrefproxy

from vine.utils import wraps

from kombu.log import get_logger

if sys.version_info >= (3, 9):
    from zoneinfo import ZoneInfo
else:
    from backports.zoneinfo import ZoneInfo

if TYPE_CHECKING:
    from types import TracebackType

__all__ = ('Entry', 'Timer', 'to_timestamp')

logger = get_logger(__name__)

DEFAULT_MAX_INTERVAL = 2
EPOCH = datetime.fromtimestamp(0, ZoneInfo("UTC"))
IS_PYPY = hasattr(sys, 'pypy_version_info')

scheduled = namedtuple('scheduled', ('eta', 'priority', 'entry'))


def to_timestamp(d, default_timezone=ZoneInfo("UTC"), time=monotonic):
    """Convert datetime to timestamp.

    If d' is already a timestamp, then that will be used.
    """
    if isinstance(d, datetime):
        if d.tzinfo is None:
            d = d.replace(tzinfo=default_timezone)
        diff = _time() - time()
        return max((d - EPOCH).total_seconds() - diff, 0)
    return d


@total_ordering
class Entry:
    """Schedule Entry."""

    if not IS_PYPY:  # pragma: no cover
        __slots__ = (
            'fun', 'args', 'kwargs', 'tref', 'canceled',
            '_last_run', '__weakref__',
        )

    def __init__(self, fun, args=None, kwargs=None):
        self.fun = fun
        self.args = args or []
        self.kwargs = kwargs or {}
        self.tref = weakrefproxy(self)
        self._last_run = None
        self.canceled = False

    def __call__(self):
        return self.fun(*self.args, **self.kwargs)

    def cancel(self):
        try:
            self.tref.canceled = True
        except ReferenceError:  # pragma: no cover
            pass

    def __repr__(self):
        return '<TimerEntry: {}(*{!r}, **{!r})'.format(
            self.fun.__name__, self.args, self.kwargs)

    # must not use hash() to order entries
    def __lt__(self, other):
        return id(self) < id(other)

    @property
    def cancelled(self):
        return self.canceled

    @cancelled.setter
    def cancelled(self, value):
        self.canceled = value


class Timer:
    """Async timer implementation."""

    Entry = Entry

    on_error = None

    def __init__(self, max_interval=None, on_error=None, **kwargs):
        self.max_interval = float(max_interval or DEFAULT_MAX_INTERVAL)
        self.on_error = on_error or self.on_error
        self._queue = []

    def __enter__(self):
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_val: BaseException | None,
        exc_tb: TracebackType | None
    ) -> None:
        self.stop()

    def call_at(self, eta, fun, args=(), kwargs=None, priority=0):
        kwargs = {} if not kwargs else kwargs
        return self.enter_at(self.Entry(fun, args, kwargs), eta, priority)

    def call_after(self, secs, fun, args=(), kwargs=None, priority=0):
        kwargs = {} if not kwargs else kwargs
        return self.enter_after(secs, self.Entry(fun, args, kwargs), priority)

    def call_repeatedly(self, secs, fun, args=(), kwargs=None, priority=0):
        kwargs = {} if not kwargs else kwargs
        tref = self.Entry(fun, args, kwargs)

        @wraps(fun)
        def _reschedules(*args, **kwargs):
            last, now = tref._last_run, monotonic()
            lsince = (now - tref._last_run) if last else secs
            try:
                if lsince and lsince >= secs:
                    tref._last_run = now
                    return fun(*args, **kwargs)
            finally:
                if not tref.canceled:
                    last = tref._last_run
                    next = secs - (now - last) if last else secs
                    self.enter_after(next, tref, priority)

        tref.fun = _reschedules
        tref._last_run = None
        return self.enter_after(secs, tref, priority)

    def enter_at(self, entry, eta=None, priority=0, time=monotonic):
        """Enter function into the scheduler.

        Arguments:
        ---------
            entry (~kombu.asynchronous.timer.Entry): Item to enter.
            eta (datetime.datetime): Scheduled time.
            priority (int): Unused.
        """
        if eta is None:
            eta = time()
        if isinstance(eta, datetime):
            try:
                eta = to_timestamp(eta)
            except Exception as exc:
                if not self.handle_error(exc):
                    raise
                return
        return self._enter(eta, priority, entry)

    def enter_after(self, secs, entry, priority=0, time=monotonic):
        return self.enter_at(entry, time() + float(secs), priority)

    def _enter(self, eta, priority, entry, push=heapq.heappush):
        push(self._queue, scheduled(eta, priority, entry))
        return entry

    def apply_entry(self, entry):
        try:
            entry()
        except Exception as exc:
            if not self.handle_error(exc):
                logger.error('Error in timer: %r', exc, exc_info=True)

    def handle_error(self, exc_info):
        if self.on_error:
            self.on_error(exc_info)
            return True

    def stop(self):
        pass

    def __iter__(self, min=min, nowfun=monotonic,
                 pop=heapq.heappop, push=heapq.heappush):
        """Iterate over schedule.

        This iterator yields a tuple of ``(wait_seconds, entry)``,
        where if entry is :const:`None` the caller should wait
        for ``wait_seconds`` until it polls the schedule again.
        """
        max_interval = self.max_interval
        queue = self._queue

        while 1:
            if queue:
                eventA = queue[0]
                now, eta = nowfun(), eventA[0]

                if now < eta:
                    yield min(eta - now, max_interval), None
                else:
                    eventB = pop(queue)

                    if eventB is eventA:
                        entry = eventA[2]
                        if not entry.canceled:
                            yield None, entry
                        continue
                    else:
                        push(queue, eventB)
            else:
                yield None, None

    def clear(self):
        self._queue[:] = []  # atomic, without creating a new list.

    def cancel(self, tref):
        tref.cancel()

    def __len__(self):
        return len(self._queue)

    def __nonzero__(self):
        return True

    @property
    def queue(self, _pop=heapq.heappop):
        """Snapshot of underlying datastructure."""
        events = list(self._queue)
        return [_pop(v) for v in [events] * len(events)]

    @property
    def schedule(self):
        return self
