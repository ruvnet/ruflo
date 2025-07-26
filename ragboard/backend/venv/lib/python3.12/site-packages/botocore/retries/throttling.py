from collections import namedtuple

CubicParams = namedtuple('CubicParams', ['w_max', 'k', 'last_fail'])


class CubicCalculator:
    _SCALE_CONSTANT = 0.4
    _BETA = 0.7

    def __init__(
        self,
        starting_max_rate,
        start_time,
        scale_constant=_SCALE_CONSTANT,
        beta=_BETA,
    ):
        self._w_max = starting_max_rate
        self._scale_constant = scale_constant
        self._beta = beta
        self._k = self._calculate_zero_point()
        self._last_fail = start_time

    def _calculate_zero_point(self):
        scaled_value = (self._w_max * (1 - self._beta)) / self._scale_constant
        k = scaled_value ** (1 / 3.0)
        return k

    def success_received(self, timestamp):
        dt = timestamp - self._last_fail
        new_rate = self._scale_constant * (dt - self._k) ** 3 + self._w_max
        return new_rate

    def error_received(self, current_rate, timestamp):
        # Consider not having this be the current measured rate.

        # We have a new max rate, which is the current rate we were sending
        # at when we received an error response.
        self._w_max = current_rate
        self._k = self._calculate_zero_point()
        self._last_fail = timestamp
        return current_rate * self._beta

    def get_params_snapshot(self):
        """Return a read-only object of the current cubic parameters.

        These parameters are intended to be used for debug/troubleshooting
        purposes.  These object is a read-only snapshot and cannot be used
        to modify the behavior of the CUBIC calculations.

        New parameters may be added to this object in the future.

        """
        return CubicParams(
            w_max=self._w_max, k=self._k, last_fail=self._last_fail
        )
