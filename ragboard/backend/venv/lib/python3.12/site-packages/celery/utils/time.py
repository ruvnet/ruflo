"""Utilities related to dates, times, intervals, and timezones."""
from __future__ import annotations

import numbers
import os
import random
import sys
import time as _time
from calendar import monthrange
from datetime import date, datetime, timedelta
from datetime import timezone as datetime_timezone
from datetime import tzinfo
from types import ModuleType
from typing import Any, Callable

from dateutil import tz as dateutil_tz
from kombu.utils.functional import reprcall
from kombu.utils.objects import cached_property

from .functional import dictfilter
from .text import pluralize

if sys.version_info >= (3, 9):
    from zoneinfo import ZoneInfo
else:
    from backports.zoneinfo import ZoneInfo


__all__ = (
    'LocalTimezone', 'timezone', 'maybe_timedelta',
    'delta_resolution', 'remaining', 'rate', 'weekday',
    'humanize_seconds', 'maybe_iso8601', 'is_naive',
    'make_aware', 'localize', 'to_utc', 'maybe_make_aware',
    'ffwd', 'utcoffset', 'adjust_timestamp',
    'get_exponential_backoff_interval',
)

C_REMDEBUG = os.environ.get('C_REMDEBUG', False)

DAYNAMES = 'sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'
WEEKDAYS = dict(zip(DAYNAMES, range(7)))

RATE_MODIFIER_MAP = {
    's': lambda n: n,
    'm': lambda n: n / 60.0,
    'h': lambda n: n / 60.0 / 60.0,
}

TIME_UNITS = (
    ('day', 60 * 60 * 24.0, lambda n: format(n, '.2f')),
    ('hour', 60 * 60.0, lambda n: format(n, '.2f')),
    ('minute', 60.0, lambda n: format(n, '.2f')),
    ('second', 1.0, lambda n: format(n, '.2f')),
)

ZERO = timedelta(0)

_local_timezone = None


class LocalTimezone(tzinfo):
    """Local time implementation. Provided in _Zone to the app when `enable_utc` is disabled.
    Otherwise, _Zone provides a UTC ZoneInfo instance as the timezone implementation for the application.

    Note:
        Used only when the :setting:`enable_utc` setting is disabled.
    """

    _offset_cache: dict[int, tzinfo] = {}

    def __init__(self) -> None:
        # This code is moved in __init__ to execute it as late as possible
        # See get_default_timezone().
        self.STDOFFSET = timedelta(seconds=-_time.timezone)
        if _time.daylight:
            self.DSTOFFSET = timedelta(seconds=-_time.altzone)
        else:
            self.DSTOFFSET = self.STDOFFSET
        self.DSTDIFF = self.DSTOFFSET - self.STDOFFSET
        super().__init__()

    def __repr__(self) -> str:
        return f'<LocalTimezone: UTC{int(self.DSTOFFSET.total_seconds() / 3600):+03d}>'

    def utcoffset(self, dt: datetime) -> timedelta:
        return self.DSTOFFSET if self._isdst(dt) else self.STDOFFSET

    def dst(self, dt: datetime) -> timedelta:
        return self.DSTDIFF if self._isdst(dt) else ZERO

    def tzname(self, dt: datetime) -> str:
        return _time.tzname[self._isdst(dt)]

    def fromutc(self, dt: datetime) -> datetime:
        # The base tzinfo class no longer implements a DST
        # offset aware .fromutc() in Python 3 (Issue #2306).
        offset = int(self.utcoffset(dt).seconds / 60.0)
        try:
            tz = self._offset_cache[offset]
        except KeyError:
            tz = self._offset_cache[offset] = datetime_timezone(
                timedelta(minutes=offset))
        return tz.fromutc(dt.replace(tzinfo=tz))

    def _isdst(self, dt: datetime) -> bool:
        tt = (dt.year, dt.month, dt.day,
              dt.hour, dt.minute, dt.second,
              dt.weekday(), 0, 0)
        stamp = _time.mktime(tt)
        tt = _time.localtime(stamp)
        return tt.tm_isdst > 0


class _Zone:
    """Timezone class that provides the timezone for the application.
    If `enable_utc` is disabled, LocalTimezone is provided as the timezone provider through local().
    Otherwise, this class provides a UTC ZoneInfo instance as the timezone provider for the application.

    Additionally this class provides a few utility methods for converting datetimes.
    """

    def tz_or_local(self, tzinfo: tzinfo | None = None) -> tzinfo:
        """Return either our local timezone or the provided timezone."""

        # pylint: disable=redefined-outer-name
        if tzinfo is None:
            return self.local
        return self.get_timezone(tzinfo)

    def to_local(self, dt: datetime, local=None, orig=None):
        """Converts a datetime to the local timezone."""

        if is_naive(dt):
            dt = make_aware(dt, orig or self.utc)
        return localize(dt, self.tz_or_local(local))

    def to_system(self, dt: datetime) -> datetime:
        """Converts a datetime to the system timezone."""

        # tz=None is a special case since Python 3.3, and will
        # convert to the current local timezone (Issue #2306).
        return dt.astimezone(tz=None)

    def to_local_fallback(self, dt: datetime) -> datetime:
        """Converts a datetime to the local timezone, or the system timezone."""
        if is_naive(dt):
            return make_aware(dt, self.local)
        return localize(dt, self.local)

    def get_timezone(self, zone: str | tzinfo) -> tzinfo:
        """Returns ZoneInfo timezone if the provided zone is a string, otherwise return the zone."""
        if isinstance(zone, str):
            return ZoneInfo(zone)
        return zone

    @cached_property
    def local(self) -> LocalTimezone:
        """Return LocalTimezone instance for the application."""
        return LocalTimezone()

    @cached_property
    def utc(self) -> tzinfo:
        """Return UTC timezone created with ZoneInfo."""
        return self.get_timezone('UTC')


timezone = _Zone()


def maybe_timedelta(delta: int) -> timedelta:
    """Convert integer to timedelta, if argument is an integer."""
    if isinstance(delta, numbers.Real):
        return timedelta(seconds=delta)
    return delta


def delta_resolution(dt: datetime, delta: timedelta) -> datetime:
    """Round a :class:`~datetime.datetime` to the resolution of timedelta.

    If the :class:`~datetime.timedelta` is in days, the
    :class:`~datetime.datetime` will be rounded to the nearest days,
    if the :class:`~datetime.timedelta` is in hours the
    :class:`~datetime.datetime` will be rounded to the nearest hour,
    and so on until seconds, which will just return the original
    :class:`~datetime.datetime`.
    """
    delta = max(delta.total_seconds(), 0)

    resolutions = ((3, lambda x: x / 86400),
                   (4, lambda x: x / 3600),
                   (5, lambda x: x / 60))

    args = dt.year, dt.month, dt.day, dt.hour, dt.minute, dt.second
    for res, predicate in resolutions:
        if predicate(delta) >= 1.0:
            return datetime(*args[:res], tzinfo=dt.tzinfo)
    return dt


def remaining(
        start: datetime, ends_in: timedelta, now: Callable | None = None,
        relative: bool = False) -> timedelta:
    """Calculate the remaining time for a start date and a timedelta.

    For example, "how many seconds left for 30 seconds after start?"

    Arguments:
        start (~datetime.datetime): Starting date.
        ends_in (~datetime.timedelta): The end delta.
        relative (bool): If enabled the end time will be calculated
            using :func:`delta_resolution` (i.e., rounded to the
            resolution of `ends_in`).
        now (Callable): Function returning the current time and date.
            Defaults to :func:`datetime.utcnow`.

    Returns:
        ~datetime.timedelta: Remaining time.
    """
    now = now or datetime.utcnow()
    if str(
            start.tzinfo) == str(
            now.tzinfo) and now.utcoffset() != start.utcoffset():
        # DST started/ended
        start = start.replace(tzinfo=now.tzinfo)
    end_date = start + ends_in
    if relative:
        end_date = delta_resolution(end_date, ends_in).replace(microsecond=0)
    ret = end_date - now
    if C_REMDEBUG:  # pragma: no cover
        print('rem: NOW:{!r} START:{!r} ENDS_IN:{!r} END_DATE:{} REM:{}'.format(
            now, start, ends_in, end_date, ret))
    return ret


def rate(r: str) -> float:
    """Convert rate string (`"100/m"`, `"2/h"` or `"0.5/s"`) to seconds."""
    if r:
        if isinstance(r, str):
            ops, _, modifier = r.partition('/')
            return RATE_MODIFIER_MAP[modifier or 's'](float(ops)) or 0
        return r or 0
    return 0


def weekday(name: str) -> int:
    """Return the position of a weekday: 0 - 7, where 0 is Sunday.

    Example:
        >>> weekday('sunday'), weekday('sun'), weekday('mon')
        (0, 0, 1)
    """
    abbreviation = name[0:3].lower()
    try:
        return WEEKDAYS[abbreviation]
    except KeyError:
        # Show original day name in exception, instead of abbr.
        raise KeyError(name)


def humanize_seconds(
        secs: int, prefix: str = '', sep: str = '', now: str = 'now',
        microseconds: bool = False) -> str:
    """Show seconds in human form.

    For example, 60 becomes "1 minute", and 7200 becomes "2 hours".

    Arguments:
        prefix (str): can be used to add a preposition to the output
            (e.g., 'in' will give 'in 1 second', but add nothing to 'now').
        now (str): Literal 'now'.
        microseconds (bool): Include microseconds.
    """
    secs = float(format(float(secs), '.2f'))
    for unit, divider, formatter in TIME_UNITS:
        if secs >= divider:
            w = secs / float(divider)
            return '{}{}{} {}'.format(prefix, sep, formatter(w),
                                      pluralize(w, unit))
    if microseconds and secs > 0.0:
        return '{prefix}{sep}{0:.2f} seconds'.format(
            secs, sep=sep, prefix=prefix)
    return now


def maybe_iso8601(dt: datetime | str | None) -> None | datetime:
    """Either ``datetime | str -> datetime`` or ``None -> None``."""
    if not dt:
        return
    if isinstance(dt, datetime):
        return dt
    return datetime.fromisoformat(dt)


def is_naive(dt: datetime) -> bool:
    """Return True if :class:`~datetime.datetime` is naive, meaning it doesn't have timezone info set."""
    return dt.tzinfo is None or dt.tzinfo.utcoffset(dt) is None


def _can_detect_ambiguous(tz: tzinfo) -> bool:
    """Helper function to determine if a timezone can detect ambiguous times using dateutil."""

    return isinstance(tz, ZoneInfo) or hasattr(tz, "is_ambiguous")


def _is_ambigious(dt: datetime, tz: tzinfo) -> bool:
    """Helper function to determine if a timezone is ambiguous using python's dateutil module.

    Returns False if the timezone cannot detect ambiguity, or if there is no ambiguity, otherwise True.

    In order to detect ambiguous datetimes, the timezone must be built using ZoneInfo, or have an is_ambiguous
    method. Previously, pytz timezones would throw an AmbiguousTimeError if the localized dt was ambiguous,
    but now we need to specifically check for ambiguity with dateutil, as pytz is deprecated.
    """

    return _can_detect_ambiguous(tz) and dateutil_tz.datetime_ambiguous(dt)


def make_aware(dt: datetime, tz: tzinfo) -> datetime:
    """Set timezone for a :class:`~datetime.datetime` object."""

    dt = dt.replace(tzinfo=tz)
    if _is_ambigious(dt, tz):
        dt = min(dt.replace(fold=0), dt.replace(fold=1))
    return dt


def localize(dt: datetime, tz: tzinfo) -> datetime:
    """Convert aware :class:`~datetime.datetime` to another timezone.

    Using a ZoneInfo timezone will give the most flexibility in terms of ambiguous DST handling.
    """
    if is_naive(dt):  # Ensure timezone aware datetime
        dt = make_aware(dt, tz)
    if dt.tzinfo == ZoneInfo("UTC"):
        dt = dt.astimezone(tz)  # Always safe to call astimezone on utc zones
    return dt


def to_utc(dt: datetime) -> datetime:
    """Convert naive :class:`~datetime.datetime` to UTC."""
    return make_aware(dt, timezone.utc)


def maybe_make_aware(dt: datetime, tz: tzinfo | None = None,
                     naive_as_utc: bool = True) -> datetime:
    """Convert dt to aware datetime, do nothing if dt is already aware."""
    if is_naive(dt):
        if naive_as_utc:
            dt = to_utc(dt)
        return localize(
            dt, timezone.utc if tz is None else timezone.tz_or_local(tz),
        )
    return dt


class ffwd:
    """Version of ``dateutil.relativedelta`` that only supports addition."""

    def __init__(self, year=None, month=None, weeks=0, weekday=None, day=None,
                 hour=None, minute=None, second=None, microsecond=None,
                 **kwargs: Any):
        # pylint: disable=redefined-outer-name
        # weekday is also a function in outer scope.
        self.year = year
        self.month = month
        self.weeks = weeks
        self.weekday = weekday
        self.day = day
        self.hour = hour
        self.minute = minute
        self.second = second
        self.microsecond = microsecond
        self.days = weeks * 7
        self._has_time = self.hour is not None or self.minute is not None

    def __repr__(self) -> str:
        return reprcall('ffwd', (), self._fields(weeks=self.weeks,
                                                 weekday=self.weekday))

    def __radd__(self, other: Any) -> timedelta:
        if not isinstance(other, date):
            return NotImplemented
        year = self.year or other.year
        month = self.month or other.month
        day = min(monthrange(year, month)[1], self.day or other.day)
        ret = other.replace(**dict(dictfilter(self._fields()),
                                   year=year, month=month, day=day))
        if self.weekday is not None:
            ret += timedelta(days=(7 - ret.weekday() + self.weekday) % 7)
        return ret + timedelta(days=self.days)

    def _fields(self, **extra: Any) -> dict[str, Any]:
        return dictfilter({
            'year': self.year, 'month': self.month, 'day': self.day,
            'hour': self.hour, 'minute': self.minute,
            'second': self.second, 'microsecond': self.microsecond,
        }, **extra)


def utcoffset(
        time: ModuleType = _time,
        localtime: Callable[..., _time.struct_time] = _time.localtime) -> float:
    """Return the current offset to UTC in hours."""
    if localtime().tm_isdst:
        return time.altzone // 3600
    return time.timezone // 3600


def adjust_timestamp(ts: float, offset: int,
                     here: Callable[..., float] = utcoffset) -> float:
    """Adjust timestamp based on provided utcoffset."""
    return ts - (offset - here()) * 3600


def get_exponential_backoff_interval(
    factor: int,
    retries: int,
    maximum: int,
    full_jitter: bool = False
) -> int:
    """Calculate the exponential backoff wait time."""
    # Will be zero if factor equals 0
    countdown = min(maximum, factor * (2 ** retries))
    # Full jitter according to
    # https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/
    if full_jitter:
        countdown = random.randrange(countdown + 1)
    # Adjust according to maximum wait time and account for negative values.
    return max(0, countdown)
