# -*- coding: UTF-8 -*-

import re
import datetime

_nanosecond_size  = 1
_microsecond_size = 1000 * _nanosecond_size
_millisecond_size = 1000 * _microsecond_size
_second_size      = 1000 * _millisecond_size
_minute_size      = 60   * _second_size
_hour_size        = 60   * _minute_size
_day_size         = 24   * _hour_size
_week_size        = 7    * _day_size
_month_size       = 30   * _day_size
_year_size        = 365  * _day_size

units = {
    "ns": _nanosecond_size,
    "us": _microsecond_size,
    "µs": _microsecond_size,
    "μs": _microsecond_size,
    "ms": _millisecond_size,
    "s":  _second_size,
    "m":  _minute_size,
    "h":  _hour_size,
    "d":  _day_size,
    "w":  _week_size,
    "mm": _month_size,
    "y":  _year_size,
}

_duration_re = re.compile(r'([\d\.]+)([a-zµμ]+)')


class DurationError(ValueError):
    """duration error"""


def from_str(duration):
    """Parse a duration string to a datetime.timedelta"""

    original = duration

    if duration in ("0", "+0", "-0"):
        return datetime.timedelta()

    sign = 1
    if duration and duration[0] in '+-':
        if duration[0] == '-':
            sign = -1
        duration = duration[1:]

    matches = list(_duration_re.finditer(duration))
    if not matches:
        raise DurationError("Invalid duration {}".format(original))
    if matches[0].start() != 0 or matches[-1].end() != len(duration):
        raise DurationError(
            'Extra chars at start or end of duration {}'.format(original))

    total = 0
    for match in matches:
        value, unit = match.groups()
        if unit not in units:
            raise DurationError(
                "Unknown unit {} in duration {}".format(unit, original))
        try:
            total += float(value) * units[unit]
        except Exception:
            raise DurationError(
                "Invalid value {} in duration {}".format(value, original))

    microseconds = total / _microsecond_size
    return datetime.timedelta(microseconds=sign * microseconds)

def to_str(delta, extended=False):
    """Format a datetime.timedelta to a duration string"""

    total_seconds = delta.total_seconds()
    sign = "-" if total_seconds < 0 else ""
    nanoseconds = round(abs(total_seconds * _second_size), 0)

    if abs(total_seconds) < 1:
        result_str = _to_str_small(nanoseconds, extended)
    else:
        result_str = _to_str_large(nanoseconds, extended)

    return "{}{}".format(sign, result_str)


def _to_str_small(nanoseconds, extended):

    result_str = ""

    if not nanoseconds:
        return "0"

    milliseconds = int(nanoseconds / _millisecond_size)
    if milliseconds:
        nanoseconds -= _millisecond_size * milliseconds
        result_str += "{:g}ms".format(milliseconds)

    microseconds = int(nanoseconds / _microsecond_size)
    if microseconds:
        nanoseconds -= _microsecond_size * microseconds
        result_str += "{:g}us".format(microseconds)

    if nanoseconds:
        result_str += "{:g}ns".format(nanoseconds)

    return result_str


def _to_str_large(nanoseconds, extended):

    result_str = ""

    if extended:

        years = int(nanoseconds / _year_size)
        if years:
            nanoseconds -= _year_size * years
            result_str += "{:g}y".format(years)

        months = int(nanoseconds / _month_size)
        if months:
            nanoseconds -= _month_size * months
            result_str += "{:g}mm".format(months)

        days = int(nanoseconds / _day_size)
        if days:
            nanoseconds -= _day_size * days
            result_str += "{:g}d".format(days)

    hours = int(nanoseconds / _hour_size)
    if hours:
        nanoseconds -= _hour_size * hours
        result_str += "{:g}h".format(hours)

    minutes = int(nanoseconds / _minute_size)
    if minutes:
        nanoseconds -= _minute_size * minutes
        result_str += "{:g}m".format(minutes)

    seconds = float(nanoseconds) / float(_second_size)
    if seconds:
        nanoseconds -= _second_size * seconds
        result_str += "{:g}s".format(seconds)

    return result_str
