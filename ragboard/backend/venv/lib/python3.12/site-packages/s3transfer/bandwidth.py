# Copyright 2017 Amazon.com, Inc. or its affiliates. All Rights Reserved.
#
# Licensed under the Apache License, Version 2.0 (the "License"). You
# may not use this file except in compliance with the License. A copy of
# the License is located at
#
# http://aws.amazon.com/apache2.0/
#
# or in the "license" file accompanying this file. This file is
# distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF
# ANY KIND, either express or implied. See the License for the specific
# language governing permissions and limitations under the License.
import threading
import time


class RequestExceededException(Exception):
    def __init__(self, requested_amt, retry_time):
        """Error when requested amount exceeds what is allowed

        The request that raised this error should be retried after waiting
        the time specified by ``retry_time``.

        :type requested_amt: int
        :param requested_amt: The originally requested byte amount

        :type retry_time: float
        :param retry_time: The length in time to wait to retry for the
            requested amount
        """
        self.requested_amt = requested_amt
        self.retry_time = retry_time
        msg = f'Request amount {requested_amt} exceeded the amount available. Retry in {retry_time}'
        super().__init__(msg)


class RequestToken:
    """A token to pass as an identifier when consuming from the LeakyBucket"""

    pass


class TimeUtils:
    def time(self):
        """Get the current time back

        :rtype: float
        :returns: The current time in seconds
        """
        return time.time()

    def sleep(self, value):
        """Sleep for a designated time

        :type value: float
        :param value: The time to sleep for in seconds
        """
        return time.sleep(value)


class BandwidthLimiter:
    def __init__(self, leaky_bucket, time_utils=None):
        """Limits bandwidth for shared S3 transfers

        :type leaky_bucket: LeakyBucket
        :param leaky_bucket: The leaky bucket to use limit bandwidth

        :type time_utils: TimeUtils
        :param time_utils: Time utility to use for interacting with time.
        """
        self._leaky_bucket = leaky_bucket
        self._time_utils = time_utils
        if time_utils is None:
            self._time_utils = TimeUtils()

    def get_bandwith_limited_stream(
        self, fileobj, transfer_coordinator, enabled=True
    ):
        """Wraps a fileobj in a bandwidth limited stream wrapper

        :type fileobj: file-like obj
        :param fileobj: The file-like obj to wrap

        :type transfer_coordinator: s3transfer.futures.TransferCoordinator
        param transfer_coordinator: The coordinator for the general transfer
            that the wrapped stream is a part of

        :type enabled: boolean
        :param enabled: Whether bandwidth limiting should be enabled to start
        """
        stream = BandwidthLimitedStream(
            fileobj, self._leaky_bucket, transfer_coordinator, self._time_utils
        )
        if not enabled:
            stream.disable_bandwidth_limiting()
        return stream


class BandwidthLimitedStream:
    def __init__(
        self,
        fileobj,
        leaky_bucket,
        transfer_coordinator,
        time_utils=None,
        bytes_threshold=256 * 1024,
    ):
        """Limits bandwidth for reads on a wrapped stream

        :type fileobj: file-like object
        :param fileobj: The file like object to wrap

        :type leaky_bucket: LeakyBucket
        :param leaky_bucket: The leaky bucket to use to throttle reads on
            the stream

        :type transfer_coordinator: s3transfer.futures.TransferCoordinator
        param transfer_coordinator: The coordinator for the general transfer
            that the wrapped stream is a part of

        :type time_utils: TimeUtils
        :param time_utils: The time utility to use for interacting with time
        """
        self._fileobj = fileobj
        self._leaky_bucket = leaky_bucket
        self._transfer_coordinator = transfer_coordinator
        self._time_utils = time_utils
        if time_utils is None:
            self._time_utils = TimeUtils()
        self._bandwidth_limiting_enabled = True
        self._request_token = RequestToken()
        self._bytes_seen = 0
        self._bytes_threshold = bytes_threshold

    def enable_bandwidth_limiting(self):
        """Enable bandwidth limiting on reads to the stream"""
        self._bandwidth_limiting_enabled = True

    def disable_bandwidth_limiting(self):
        """Disable bandwidth limiting on reads to the stream"""
        self._bandwidth_limiting_enabled = False

    def read(self, amount):
        """Read a specified amount

        Reads will only be throttled if bandwidth limiting is enabled.
        """
        if not self._bandwidth_limiting_enabled:
            return self._fileobj.read(amount)

        # We do not want to be calling consume on every read as the read
        # amounts can be small causing the lock of the leaky bucket to
        # introduce noticeable overhead. So instead we keep track of
        # how many bytes we have seen and only call consume once we pass a
        # certain threshold.
        self._bytes_seen += amount
        if self._bytes_seen < self._bytes_threshold:
            return self._fileobj.read(amount)

        self._consume_through_leaky_bucket()
        return self._fileobj.read(amount)

    def _consume_through_leaky_bucket(self):
        # NOTE: If the read amount on the stream are high, it will result
        # in large bursty behavior as there is not an interface for partial
        # reads. However given the read's on this abstraction are at most 256KB
        # (via downloads), it reduces the burstiness to be small KB bursts at
        # worst.
        while not self._transfer_coordinator.exception:
            try:
                self._leaky_bucket.consume(
                    self._bytes_seen, self._request_token
                )
                self._bytes_seen = 0
                return
            except RequestExceededException as e:
                self._time_utils.sleep(e.retry_time)
        else:
            raise self._transfer_coordinator.exception

    def signal_transferring(self):
        """Signal that data being read is being transferred to S3"""
        self.enable_bandwidth_limiting()

    def signal_not_transferring(self):
        """Signal that data being read is not being transferred to S3"""
        self.disable_bandwidth_limiting()

    def seek(self, where, whence=0):
        self._fileobj.seek(where, whence)

    def tell(self):
        return self._fileobj.tell()

    def close(self):
        if self._bandwidth_limiting_enabled and self._bytes_seen:
            # This handles the case where the file is small enough to never
            # trigger the threshold and thus is never subjugated to the
            # leaky bucket on read(). This specifically happens for small
            # uploads. So instead to account for those bytes, have
            # it go through the leaky bucket when the file gets closed.
            self._consume_through_leaky_bucket()
        self._fileobj.close()

    def __enter__(self):
        return self

    def __exit__(self, *args, **kwargs):
        self.close()


class LeakyBucket:
    def __init__(
        self,
        max_rate,
        time_utils=None,
        rate_tracker=None,
        consumption_scheduler=None,
    ):
        """A leaky bucket abstraction to limit bandwidth consumption

        :type rate: int
        :type rate: The maximum rate to allow. This rate is in terms of
            bytes per second.

        :type time_utils: TimeUtils
        :param time_utils: The time utility to use for interacting with time

        :type rate_tracker: BandwidthRateTracker
        :param rate_tracker: Tracks bandwidth consumption

        :type consumption_scheduler: ConsumptionScheduler
        :param consumption_scheduler: Schedules consumption retries when
            necessary
        """
        self._max_rate = float(max_rate)
        self._time_utils = time_utils
        if time_utils is None:
            self._time_utils = TimeUtils()
        self._lock = threading.Lock()
        self._rate_tracker = rate_tracker
        if rate_tracker is None:
            self._rate_tracker = BandwidthRateTracker()
        self._consumption_scheduler = consumption_scheduler
        if consumption_scheduler is None:
            self._consumption_scheduler = ConsumptionScheduler()

    def consume(self, amt, request_token):
        """Consume an a requested amount

        :type amt: int
        :param amt: The amount of bytes to request to consume

        :type request_token: RequestToken
        :param request_token: The token associated to the consumption
            request that is used to identify the request. So if a
            RequestExceededException is raised the token should be used
            in subsequent retry consume() request.

        :raises RequestExceededException: If the consumption amount would
            exceed the maximum allocated bandwidth

        :rtype: int
        :returns: The amount consumed
        """
        with self._lock:
            time_now = self._time_utils.time()
            if self._consumption_scheduler.is_scheduled(request_token):
                return self._release_requested_amt_for_scheduled_request(
                    amt, request_token, time_now
                )
            elif self._projected_to_exceed_max_rate(amt, time_now):
                self._raise_request_exceeded_exception(
                    amt, request_token, time_now
                )
            else:
                return self._release_requested_amt(amt, time_now)

    def _projected_to_exceed_max_rate(self, amt, time_now):
        projected_rate = self._rate_tracker.get_projected_rate(amt, time_now)
        return projected_rate > self._max_rate

    def _release_requested_amt_for_scheduled_request(
        self, amt, request_token, time_now
    ):
        self._consumption_scheduler.process_scheduled_consumption(
            request_token
        )
        return self._release_requested_amt(amt, time_now)

    def _raise_request_exceeded_exception(self, amt, request_token, time_now):
        allocated_time = amt / float(self._max_rate)
        retry_time = self._consumption_scheduler.schedule_consumption(
            amt, request_token, allocated_time
        )
        raise RequestExceededException(
            requested_amt=amt, retry_time=retry_time
        )

    def _release_requested_amt(self, amt, time_now):
        self._rate_tracker.record_consumption_rate(amt, time_now)
        return amt


class ConsumptionScheduler:
    def __init__(self):
        """Schedules when to consume a desired amount"""
        self._tokens_to_scheduled_consumption = {}
        self._total_wait = 0

    def is_scheduled(self, token):
        """Indicates if a consumption request has been scheduled

        :type token: RequestToken
        :param token: The token associated to the consumption
            request that is used to identify the request.
        """
        return token in self._tokens_to_scheduled_consumption

    def schedule_consumption(self, amt, token, time_to_consume):
        """Schedules a wait time to be able to consume an amount

        :type amt: int
        :param amt: The amount of bytes scheduled to be consumed

        :type token: RequestToken
        :param token: The token associated to the consumption
            request that is used to identify the request.

        :type time_to_consume: float
        :param time_to_consume: The desired time it should take for that
            specific request amount to be consumed in regardless of previously
            scheduled consumption requests

        :rtype: float
        :returns: The amount of time to wait for the specific request before
            actually consuming the specified amount.
        """
        self._total_wait += time_to_consume
        self._tokens_to_scheduled_consumption[token] = {
            'wait_duration': self._total_wait,
            'time_to_consume': time_to_consume,
        }
        return self._total_wait

    def process_scheduled_consumption(self, token):
        """Processes a scheduled consumption request that has completed

        :type token: RequestToken
        :param token: The token associated to the consumption
            request that is used to identify the request.
        """
        scheduled_retry = self._tokens_to_scheduled_consumption.pop(token)
        self._total_wait = max(
            self._total_wait - scheduled_retry['time_to_consume'], 0
        )


class BandwidthRateTracker:
    def __init__(self, alpha=0.8):
        """Tracks the rate of bandwidth consumption

        :type a: float
        :param a: The constant to use in calculating the exponentional moving
            average of the bandwidth rate. Specifically it is used in the
            following calculation:

            current_rate = alpha * new_rate + (1 - alpha) * current_rate

            This value of this constant should be between 0 and 1.
        """
        self._alpha = alpha
        self._last_time = None
        self._current_rate = None

    @property
    def current_rate(self):
        """The current transfer rate

        :rtype: float
        :returns: The current tracked transfer rate
        """
        if self._last_time is None:
            return 0.0
        return self._current_rate

    def get_projected_rate(self, amt, time_at_consumption):
        """Get the projected rate using a provided amount and time

        :type amt: int
        :param amt: The proposed amount to consume

        :type time_at_consumption: float
        :param time_at_consumption: The proposed time to consume at

        :rtype: float
        :returns: The consumption rate if that amt and time were consumed
        """
        if self._last_time is None:
            return 0.0
        return self._calculate_exponential_moving_average_rate(
            amt, time_at_consumption
        )

    def record_consumption_rate(self, amt, time_at_consumption):
        """Record the consumption rate based off amount and time point

        :type amt: int
        :param amt: The amount that got consumed

        :type time_at_consumption: float
        :param time_at_consumption: The time at which the amount was consumed
        """
        if self._last_time is None:
            self._last_time = time_at_consumption
            self._current_rate = 0.0
            return
        self._current_rate = self._calculate_exponential_moving_average_rate(
            amt, time_at_consumption
        )
        self._last_time = time_at_consumption

    def _calculate_rate(self, amt, time_at_consumption):
        time_delta = time_at_consumption - self._last_time
        if time_delta <= 0:
            # While it is really unlikely to see this in an actual transfer,
            # we do not want to be returning back a negative rate or try to
            # divide the amount by zero. So instead return back an infinite
            # rate as the time delta is infinitesimally small.
            return float('inf')
        return amt / (time_delta)

    def _calculate_exponential_moving_average_rate(
        self, amt, time_at_consumption
    ):
        new_rate = self._calculate_rate(amt, time_at_consumption)
        return self._alpha * new_rate + (1 - self._alpha) * self._current_rate
