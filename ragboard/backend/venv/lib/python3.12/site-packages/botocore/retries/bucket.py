"""This module implements token buckets used for client side throttling."""

import threading
import time

from botocore.exceptions import CapacityNotAvailableError


class Clock:
    def __init__(self):
        pass

    def sleep(self, amount):
        time.sleep(amount)

    def current_time(self):
        return time.time()


class TokenBucket:
    _MIN_RATE = 0.5

    def __init__(self, max_rate, clock, min_rate=_MIN_RATE):
        self._fill_rate = None
        self._max_capacity = None
        self._current_capacity = 0
        self._clock = clock
        self._last_timestamp = None
        self._min_rate = min_rate
        self._lock = threading.Lock()
        self._new_fill_rate_condition = threading.Condition(self._lock)
        self.max_rate = max_rate

    @property
    def max_rate(self):
        return self._fill_rate

    @max_rate.setter
    def max_rate(self, value):
        with self._new_fill_rate_condition:
            # Before we can change the rate we need to fill any pending
            # tokens we might have based on the current rate.  If we don't
            # do this it means everything since the last recorded timestamp
            # will accumulate at the rate we're about to set which isn't
            # correct.
            self._refill()
            self._fill_rate = max(value, self._min_rate)
            if value >= 1:
                self._max_capacity = value
            else:
                self._max_capacity = 1
            # If we're scaling down, we also can't have a capacity that's
            # more than our max_capacity.
            self._current_capacity = min(
                self._current_capacity, self._max_capacity
            )
            self._new_fill_rate_condition.notify()

    @property
    def max_capacity(self):
        return self._max_capacity

    @property
    def available_capacity(self):
        return self._current_capacity

    def acquire(self, amount=1, block=True):
        """Acquire token or return amount of time until next token available.

        If block is True, then this method will block until there's sufficient
        capacity to acquire the desired amount.

        If block is False, then this method will return True is capacity
        was successfully acquired, False otherwise.

        """
        with self._new_fill_rate_condition:
            return self._acquire(amount=amount, block=block)

    def _acquire(self, amount, block):
        self._refill()
        if amount <= self._current_capacity:
            self._current_capacity -= amount
            return True
        else:
            if not block:
                raise CapacityNotAvailableError()
            # Not enough capacity.
            sleep_amount = self._sleep_amount(amount)
            while sleep_amount > 0:
                # Until python3.2, wait() always returned None so we can't
                # tell if a timeout occurred waiting on the cond var.
                # Because of this we'll unconditionally call _refill().
                # The downside to this is that we were waken up via
                # a notify(), we're calling unnecessarily calling _refill() an
                # extra time.
                self._new_fill_rate_condition.wait(sleep_amount)
                self._refill()
                sleep_amount = self._sleep_amount(amount)
            self._current_capacity -= amount
            return True

    def _sleep_amount(self, amount):
        return (amount - self._current_capacity) / self._fill_rate

    def _refill(self):
        timestamp = self._clock.current_time()
        if self._last_timestamp is None:
            self._last_timestamp = timestamp
            return
        current_capacity = self._current_capacity
        fill_amount = (timestamp - self._last_timestamp) * self._fill_rate
        new_capacity = min(self._max_capacity, current_capacity + fill_amount)
        self._current_capacity = new_capacity
        self._last_timestamp = timestamp
