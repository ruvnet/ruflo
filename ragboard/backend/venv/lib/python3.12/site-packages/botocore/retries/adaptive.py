import logging
import math
import threading

from botocore.retries import bucket, standard, throttling

logger = logging.getLogger(__name__)


def register_retry_handler(client):
    clock = bucket.Clock()
    rate_adjustor = throttling.CubicCalculator(
        starting_max_rate=0, start_time=clock.current_time()
    )
    token_bucket = bucket.TokenBucket(max_rate=1, clock=clock)
    rate_clocker = RateClocker(clock)
    throttling_detector = standard.ThrottlingErrorDetector(
        retry_event_adapter=standard.RetryEventAdapter(),
    )
    limiter = ClientRateLimiter(
        rate_adjustor=rate_adjustor,
        rate_clocker=rate_clocker,
        token_bucket=token_bucket,
        throttling_detector=throttling_detector,
        clock=clock,
    )
    client.meta.events.register(
        'before-send',
        limiter.on_sending_request,
    )
    client.meta.events.register(
        'needs-retry',
        limiter.on_receiving_response,
    )
    return limiter


class ClientRateLimiter:
    _MAX_RATE_ADJUST_SCALE = 2.0

    def __init__(
        self,
        rate_adjustor,
        rate_clocker,
        token_bucket,
        throttling_detector,
        clock,
    ):
        self._rate_adjustor = rate_adjustor
        self._rate_clocker = rate_clocker
        self._token_bucket = token_bucket
        self._throttling_detector = throttling_detector
        self._clock = clock
        self._enabled = False
        self._lock = threading.Lock()

    def on_sending_request(self, request, **kwargs):
        if self._enabled:
            self._token_bucket.acquire()

    # Hooked up to needs-retry.
    def on_receiving_response(self, **kwargs):
        measured_rate = self._rate_clocker.record()
        timestamp = self._clock.current_time()
        with self._lock:
            if not self._throttling_detector.is_throttling_error(**kwargs):
                new_rate = self._rate_adjustor.success_received(timestamp)
            else:
                if not self._enabled:
                    rate_to_use = measured_rate
                else:
                    rate_to_use = min(
                        measured_rate, self._token_bucket.max_rate
                    )
                new_rate = self._rate_adjustor.error_received(
                    rate_to_use, timestamp
                )
                logger.debug(
                    "Throttling response received, new send rate: %s "
                    "measured rate: %s, token bucket capacity "
                    "available: %s",
                    new_rate,
                    measured_rate,
                    self._token_bucket.available_capacity,
                )
                self._enabled = True
            self._token_bucket.max_rate = min(
                new_rate, self._MAX_RATE_ADJUST_SCALE * measured_rate
            )


class RateClocker:
    """Tracks the rate at which a client is sending a request."""

    _DEFAULT_SMOOTHING = 0.8
    # Update the rate every _TIME_BUCKET_RANGE seconds.
    _TIME_BUCKET_RANGE = 0.5

    def __init__(
        self,
        clock,
        smoothing=_DEFAULT_SMOOTHING,
        time_bucket_range=_TIME_BUCKET_RANGE,
    ):
        self._clock = clock
        self._measured_rate = 0
        self._smoothing = smoothing
        self._last_bucket = math.floor(self._clock.current_time())
        self._time_bucket_scale = 1 / self._TIME_BUCKET_RANGE
        self._count = 0
        self._lock = threading.Lock()

    def record(self, amount=1):
        with self._lock:
            t = self._clock.current_time()
            bucket = (
                math.floor(t * self._time_bucket_scale)
                / self._time_bucket_scale
            )
            self._count += amount
            if bucket > self._last_bucket:
                current_rate = self._count / float(bucket - self._last_bucket)
                self._measured_rate = (current_rate * self._smoothing) + (
                    self._measured_rate * (1 - self._smoothing)
                )
                self._count = 0
                self._last_bucket = bucket
            return self._measured_rate

    @property
    def measured_rate(self):
        return self._measured_rate
