"""Schedules define the intervals at which periodic tasks run."""
from __future__ import annotations

import re
from bisect import bisect, bisect_left
from collections import namedtuple
from collections.abc import Iterable
from datetime import datetime, timedelta, tzinfo
from typing import Any, Callable, Mapping, Sequence

from kombu.utils.objects import cached_property

from celery import Celery

from . import current_app
from .utils.collections import AttributeDict
from .utils.time import (ffwd, humanize_seconds, localize, maybe_make_aware, maybe_timedelta, remaining, timezone,
                         weekday)

__all__ = (
    'ParseException', 'schedule', 'crontab', 'crontab_parser',
    'maybe_schedule', 'solar',
)

schedstate = namedtuple('schedstate', ('is_due', 'next'))

CRON_PATTERN_INVALID = """\
Invalid crontab pattern.  Valid range is {min}-{max}. \
'{value}' was found.\
"""

CRON_INVALID_TYPE = """\
Argument cronspec needs to be of any of the following types: \
int, str, or an iterable type. {type!r} was given.\
"""

CRON_REPR = """\
<crontab: {0._orig_minute} {0._orig_hour} {0._orig_day_of_month} {0._orig_month_of_year} \
{0._orig_day_of_week} (m/h/dM/MY/d)>\
"""

SOLAR_INVALID_LATITUDE = """\
Argument latitude {lat} is invalid, must be between -90 and 90.\
"""

SOLAR_INVALID_LONGITUDE = """\
Argument longitude {lon} is invalid, must be between -180 and 180.\
"""

SOLAR_INVALID_EVENT = """\
Argument event "{event}" is invalid, must be one of {all_events}.\
"""


def cronfield(s: str) -> str:
    return '*' if s is None else s


class ParseException(Exception):
    """Raised by :class:`crontab_parser` when the input can't be parsed."""


class BaseSchedule:

    def __init__(self, nowfun: Callable | None = None, app: Celery | None = None):
        self.nowfun = nowfun
        self._app = app

    def now(self) -> datetime:
        return (self.nowfun or self.app.now)()

    def remaining_estimate(self, last_run_at: datetime) -> timedelta:
        raise NotImplementedError()

    def is_due(self, last_run_at: datetime) -> tuple[bool, datetime]:
        raise NotImplementedError()

    def maybe_make_aware(
            self, dt: datetime, naive_as_utc: bool = True) -> datetime:
        return maybe_make_aware(dt, self.tz, naive_as_utc=naive_as_utc)

    @property
    def app(self) -> Celery:
        return self._app or current_app._get_current_object()

    @app.setter
    def app(self, app: Celery) -> None:
        self._app = app

    @cached_property
    def tz(self) -> tzinfo:
        return self.app.timezone

    @cached_property
    def utc_enabled(self) -> bool:
        return self.app.conf.enable_utc

    def to_local(self, dt: datetime) -> datetime:
        if not self.utc_enabled:
            return timezone.to_local_fallback(dt)
        return dt

    def __eq__(self, other: Any) -> bool:
        if isinstance(other, BaseSchedule):
            return other.nowfun == self.nowfun
        return NotImplemented


class schedule(BaseSchedule):
    """Schedule for periodic task.

    Arguments:
        run_every (float, ~datetime.timedelta): Time interval.
        relative (bool):  If set to True the run time will be rounded to the
            resolution of the interval.
        nowfun (Callable): Function returning the current date and time
            (:class:`~datetime.datetime`).
        app (Celery): Celery app instance.
    """

    relative: bool = False

    def __init__(self, run_every: float | timedelta | None = None,
                 relative: bool = False, nowfun: Callable | None = None, app: Celery
                 | None = None) -> None:
        self.run_every = maybe_timedelta(run_every)
        self.relative = relative
        super().__init__(nowfun=nowfun, app=app)

    def remaining_estimate(self, last_run_at: datetime) -> timedelta:
        return remaining(
            self.maybe_make_aware(last_run_at), self.run_every,
            self.maybe_make_aware(self.now()), self.relative,
        )

    def is_due(self, last_run_at: datetime) -> tuple[bool, datetime]:
        """Return tuple of ``(is_due, next_time_to_check)``.

        Notes:
            - next time to check is in seconds.

            - ``(True, 20)``, means the task should be run now, and the next
                time to check is in 20 seconds.

            - ``(False, 12.3)``, means the task is not due, but that the
              scheduler should check again in 12.3 seconds.

        The next time to check is used to save energy/CPU cycles,
        it does not need to be accurate but will influence the precision
        of your schedule.  You must also keep in mind
        the value of :setting:`beat_max_loop_interval`,
        that decides the maximum number of seconds the scheduler can
        sleep between re-checking the periodic task intervals.  So if you
        have a task that changes schedule at run-time then your next_run_at
        check will decide how long it will take before a change to the
        schedule takes effect.  The max loop interval takes precedence
        over the next check at value returned.

        .. admonition:: Scheduler max interval variance

            The default max loop interval may vary for different schedulers.
            For the default scheduler the value is 5 minutes, but for example
            the :pypi:`django-celery-beat` database scheduler the value
            is 5 seconds.
        """
        last_run_at = self.maybe_make_aware(last_run_at)
        rem_delta = self.remaining_estimate(last_run_at)
        remaining_s = max(rem_delta.total_seconds(), 0)
        if remaining_s == 0:
            return schedstate(is_due=True, next=self.seconds)
        return schedstate(is_due=False, next=remaining_s)

    def __repr__(self) -> str:
        return f'<freq: {self.human_seconds}>'

    def __eq__(self, other: Any) -> bool:
        if isinstance(other, schedule):
            return self.run_every == other.run_every
        return self.run_every == other

    def __reduce__(self) -> tuple[type,
                                  tuple[timedelta, bool, Callable | None]]:
        return self.__class__, (self.run_every, self.relative, self.nowfun)

    @property
    def seconds(self) -> int | float:
        return max(self.run_every.total_seconds(), 0)

    @property
    def human_seconds(self) -> str:
        return humanize_seconds(self.seconds)


class crontab_parser:
    """Parser for Crontab expressions.

    Any expression of the form 'groups'
    (see BNF grammar below) is accepted and expanded to a set of numbers.
    These numbers represent the units of time that the Crontab needs to
    run on:

    .. code-block:: bnf

        digit   :: '0'..'9'
        dow     :: 'a'..'z'
        number  :: digit+ | dow+
        steps   :: number
        range   :: number ( '-' number ) ?
        numspec :: '*' | range
        expr    :: numspec ( '/' steps ) ?
        groups  :: expr ( ',' expr ) *

    The parser is a general purpose one, useful for parsing hours, minutes and
    day of week expressions.  Example usage:

    .. code-block:: pycon

        >>> minutes = crontab_parser(60).parse('*/15')
        [0, 15, 30, 45]
        >>> hours = crontab_parser(24).parse('*/4')
        [0, 4, 8, 12, 16, 20]
        >>> day_of_week = crontab_parser(7).parse('*')
        [0, 1, 2, 3, 4, 5, 6]

    It can also parse day of month and month of year expressions if initialized
    with a minimum of 1.  Example usage:

    .. code-block:: pycon

        >>> days_of_month = crontab_parser(31, 1).parse('*/3')
        [1, 4, 7, 10, 13, 16, 19, 22, 25, 28, 31]
        >>> months_of_year = crontab_parser(12, 1).parse('*/2')
        [1, 3, 5, 7, 9, 11]
        >>> months_of_year = crontab_parser(12, 1).parse('2-12/2')
        [2, 4, 6, 8, 10, 12]

    The maximum possible expanded value returned is found by the formula:

        :math:`max_ + min_ - 1`
    """

    ParseException = ParseException

    _range = r'(\w+?)-(\w+)'
    _steps = r'/(\w+)?'
    _star = r'\*'

    def __init__(self, max_: int = 60, min_: int = 0):
        self.max_ = max_
        self.min_ = min_
        self.pats: tuple[tuple[re.Pattern, Callable], ...] = (
            (re.compile(self._range + self._steps), self._range_steps),
            (re.compile(self._range), self._expand_range),
            (re.compile(self._star + self._steps), self._star_steps),
            (re.compile('^' + self._star + '$'), self._expand_star),
        )

    def parse(self, spec: str) -> set[int]:
        acc = set()
        for part in spec.split(','):
            if not part:
                raise self.ParseException('empty part')
            acc |= set(self._parse_part(part))
        return acc

    def _parse_part(self, part: str) -> list[int]:
        for regex, handler in self.pats:
            m = regex.match(part)
            if m:
                return handler(m.groups())
        return self._expand_range((part,))

    def _expand_range(self, toks: Sequence[str]) -> list[int]:
        fr = self._expand_number(toks[0])
        if len(toks) > 1:
            to = self._expand_number(toks[1])
            if to < fr:  # Wrap around max_ if necessary
                return (list(range(fr, self.min_ + self.max_)) +
                        list(range(self.min_, to + 1)))
            return list(range(fr, to + 1))
        return [fr]

    def _range_steps(self, toks: Sequence[str]) -> list[int]:
        if len(toks) != 3 or not toks[2]:
            raise self.ParseException('empty filter')
        return self._expand_range(toks[:2])[::int(toks[2])]

    def _star_steps(self, toks: Sequence[str]) -> list[int]:
        if not toks or not toks[0]:
            raise self.ParseException('empty filter')
        return self._expand_star()[::int(toks[0])]

    def _expand_star(self, *args: Any) -> list[int]:
        return list(range(self.min_, self.max_ + self.min_))

    def _expand_number(self, s: str) -> int:
        if isinstance(s, str) and s[0] == '-':
            raise self.ParseException('negative numbers not supported')
        try:
            i = int(s)
        except ValueError:
            try:
                i = weekday(s)
            except KeyError:
                raise ValueError(f'Invalid weekday literal {s!r}.')

        max_val = self.min_ + self.max_ - 1
        if i > max_val:
            raise ValueError(
                f'Invalid end range: {i} > {max_val}.')
        if i < self.min_:
            raise ValueError(
                f'Invalid beginning range: {i} < {self.min_}.')

        return i


class crontab(BaseSchedule):
    """Crontab schedule.

    A Crontab can be used as the ``run_every`` value of a
    periodic task entry to add :manpage:`crontab(5)`-like scheduling.

    Like a :manpage:`cron(5)`-job, you can specify units of time of when
    you'd like the task to execute.  It's a reasonably complete
    implementation of :command:`cron`'s features, so it should provide a fair
    degree of scheduling needs.

    You can specify a minute, an hour, a day of the week, a day of the
    month, and/or a month in the year in any of the following formats:

    .. attribute:: minute

        - A (list of) integers from 0-59 that represent the minutes of
          an hour of when execution should occur; or
        - A string representing a Crontab pattern.  This may get pretty
          advanced, like ``minute='*/15'`` (for every quarter) or
          ``minute='1,13,30-45,50-59/2'``.

    .. attribute:: hour

        - A (list of) integers from 0-23 that represent the hours of
          a day of when execution should occur; or
        - A string representing a Crontab pattern.  This may get pretty
          advanced, like ``hour='*/3'`` (for every three hours) or
          ``hour='0,8-17/2'`` (at midnight, and every two hours during
          office hours).

    .. attribute:: day_of_week

        - A (list of) integers from 0-6, where Sunday = 0 and Saturday =
          6, that represent the days of a week that execution should
          occur.
        - A string representing a Crontab pattern.  This may get pretty
          advanced, like ``day_of_week='mon-fri'`` (for weekdays only).
          (Beware that ``day_of_week='*/2'`` does not literally mean
          'every two days', but 'every day that is divisible by two'!)

    .. attribute:: day_of_month

        - A (list of) integers from 1-31 that represents the days of the
          month that execution should occur.
        - A string representing a Crontab pattern.  This may get pretty
          advanced, such as ``day_of_month='2-30/2'`` (for every even
          numbered day) or ``day_of_month='1-7,15-21'`` (for the first and
          third weeks of the month).

    .. attribute:: month_of_year

        - A (list of) integers from 1-12 that represents the months of
          the year during which execution can occur.
        - A string representing a Crontab pattern.  This may get pretty
          advanced, such as ``month_of_year='*/3'`` (for the first month
          of every quarter) or ``month_of_year='2-12/2'`` (for every even
          numbered month).

    .. attribute:: nowfun

        Function returning the current date and time
        (:class:`~datetime.datetime`).

    .. attribute:: app

        The Celery app instance.

    It's important to realize that any day on which execution should
    occur must be represented by entries in all three of the day and
    month attributes.  For example, if ``day_of_week`` is 0 and
    ``day_of_month`` is every seventh day, only months that begin
    on Sunday and are also in the ``month_of_year`` attribute will have
    execution events.  Or, ``day_of_week`` is 1 and ``day_of_month``
    is '1-7,15-21' means every first and third Monday of every month
    present in ``month_of_year``.
    """

    def __init__(self, minute: str = '*', hour: str = '*', day_of_week: str = '*',
                 day_of_month: str = '*', month_of_year: str = '*', **kwargs: Any) -> None:
        self._orig_minute = cronfield(minute)
        self._orig_hour = cronfield(hour)
        self._orig_day_of_week = cronfield(day_of_week)
        self._orig_day_of_month = cronfield(day_of_month)
        self._orig_month_of_year = cronfield(month_of_year)
        self._orig_kwargs = kwargs
        self.hour = self._expand_cronspec(hour, 24)
        self.minute = self._expand_cronspec(minute, 60)
        self.day_of_week = self._expand_cronspec(day_of_week, 7)
        self.day_of_month = self._expand_cronspec(day_of_month, 31, 1)
        self.month_of_year = self._expand_cronspec(month_of_year, 12, 1)
        super().__init__(**kwargs)

    @staticmethod
    def _expand_cronspec(
            cronspec: int | str | Iterable,
            max_: int, min_: int = 0) -> set[Any]:
        """Expand cron specification.

        Takes the given cronspec argument in one of the forms:

        .. code-block:: text

            int         (like 7)
            str         (like '3-5,*/15', '*', or 'monday')
            set         (like {0,15,30,45}
            list        (like [8-17])

        And convert it to an (expanded) set representing all time unit
        values on which the Crontab triggers.  Only in case of the base
        type being :class:`str`, parsing occurs.  (It's fast and
        happens only once for each Crontab instance, so there's no
        significant performance overhead involved.)

        For the other base types, merely Python type conversions happen.

        The argument ``max_`` is needed to determine the expansion of
        ``*`` and ranges.  The argument ``min_`` is needed to determine
        the expansion of ``*`` and ranges for 1-based cronspecs, such as
        day of month or month of year.  The default is sufficient for minute,
        hour, and day of week.
        """
        if isinstance(cronspec, int):
            result = {cronspec}
        elif isinstance(cronspec, str):
            result = crontab_parser(max_, min_).parse(cronspec)
        elif isinstance(cronspec, set):
            result = cronspec
        elif isinstance(cronspec, Iterable):
            result = set(cronspec)  # type: ignore
        else:
            raise TypeError(CRON_INVALID_TYPE.format(type=type(cronspec)))

        # assure the result does not precede the min or exceed the max
        for number in result:
            if number >= max_ + min_ or number < min_:
                raise ValueError(CRON_PATTERN_INVALID.format(
                    min=min_, max=max_ - 1 + min_, value=number))
        return result

    def _delta_to_next(self, last_run_at: datetime, next_hour: int,
                       next_minute: int) -> ffwd:
        """Find next delta.

        Takes a :class:`~datetime.datetime` of last run, next minute and hour,
        and returns a :class:`~celery.utils.time.ffwd` for the next
        scheduled day and time.

        Only called when ``day_of_month`` and/or ``month_of_year``
        cronspec is specified to further limit scheduled task execution.
        """
        datedata = AttributeDict(year=last_run_at.year)
        days_of_month = sorted(self.day_of_month)
        months_of_year = sorted(self.month_of_year)

        def day_out_of_range(year: int, month: int, day: int) -> bool:
            try:
                datetime(year=year, month=month, day=day)
            except ValueError:
                return True
            return False

        def is_before_last_run(year: int, month: int, day: int) -> bool:
            return self.maybe_make_aware(
                datetime(year, month, day, next_hour, next_minute),
                naive_as_utc=False) < last_run_at

        def roll_over() -> None:
            for _ in range(2000):
                flag = (datedata.dom == len(days_of_month) or
                        day_out_of_range(datedata.year,
                                         months_of_year[datedata.moy],
                                         days_of_month[datedata.dom]) or
                        (is_before_last_run(datedata.year,
                                            months_of_year[datedata.moy],
                                            days_of_month[datedata.dom])))

                if flag:
                    datedata.dom = 0
                    datedata.moy += 1
                    if datedata.moy == len(months_of_year):
                        datedata.moy = 0
                        datedata.year += 1
                else:
                    break
            else:
                # Tried 2000 times, we're most likely in an infinite loop
                raise RuntimeError('unable to rollover, '
                                   'time specification is probably invalid')

        if last_run_at.month in self.month_of_year:
            datedata.dom = bisect(days_of_month, last_run_at.day)
            datedata.moy = bisect_left(months_of_year, last_run_at.month)
        else:
            datedata.dom = 0
            datedata.moy = bisect(months_of_year, last_run_at.month)
            if datedata.moy == len(months_of_year):
                datedata.moy = 0
        roll_over()

        while 1:
            th = datetime(year=datedata.year,
                          month=months_of_year[datedata.moy],
                          day=days_of_month[datedata.dom])
            if th.isoweekday() % 7 in self.day_of_week:
                break
            datedata.dom += 1
            roll_over()

        return ffwd(year=datedata.year,
                    month=months_of_year[datedata.moy],
                    day=days_of_month[datedata.dom],
                    hour=next_hour,
                    minute=next_minute,
                    second=0,
                    microsecond=0)

    def __repr__(self) -> str:
        return CRON_REPR.format(self)

    def __reduce__(self) -> tuple[type, tuple[str, str, str, str, str], Any]:
        return (self.__class__, (self._orig_minute,
                                 self._orig_hour,
                                 self._orig_day_of_week,
                                 self._orig_day_of_month,
                                 self._orig_month_of_year), self._orig_kwargs)

    def __setstate__(self, state: Mapping[str, Any]) -> None:
        # Calling super's init because the kwargs aren't necessarily passed in
        # the same form as they are stored by the superclass
        super().__init__(**state)

    def remaining_delta(self, last_run_at: datetime, tz: tzinfo | None = None,
                        ffwd: type = ffwd) -> tuple[datetime, Any, datetime]:
        # caching global ffwd
        last_run_at = self.maybe_make_aware(last_run_at)
        now = self.maybe_make_aware(self.now())
        dow_num = last_run_at.isoweekday() % 7  # Sunday is day 0, not day 7

        execute_this_date = (
            last_run_at.month in self.month_of_year and
            last_run_at.day in self.day_of_month and
            dow_num in self.day_of_week
        )

        execute_this_hour = (
            execute_this_date and
            last_run_at.day == now.day and
            last_run_at.month == now.month and
            last_run_at.year == now.year and
            last_run_at.hour in self.hour and
            last_run_at.minute < max(self.minute)
        )

        if execute_this_hour:
            next_minute = min(minute for minute in self.minute
                              if minute > last_run_at.minute)
            delta = ffwd(minute=next_minute, second=0, microsecond=0)
        else:
            next_minute = min(self.minute)
            execute_today = (execute_this_date and
                             last_run_at.hour < max(self.hour))

            if execute_today:
                next_hour = min(hour for hour in self.hour
                                if hour > last_run_at.hour)
                delta = ffwd(hour=next_hour, minute=next_minute,
                             second=0, microsecond=0)
            else:
                next_hour = min(self.hour)
                all_dom_moy = (self._orig_day_of_month == '*' and
                               self._orig_month_of_year == '*')
                if all_dom_moy:
                    next_day = min([day for day in self.day_of_week
                                    if day > dow_num] or self.day_of_week)
                    add_week = next_day == dow_num

                    delta = ffwd(
                        weeks=add_week and 1 or 0,
                        weekday=(next_day - 1) % 7,
                        hour=next_hour,
                        minute=next_minute,
                        second=0,
                        microsecond=0,
                    )
                else:
                    delta = self._delta_to_next(last_run_at,
                                                next_hour, next_minute)
        return self.to_local(last_run_at), delta, self.to_local(now)

    def remaining_estimate(
            self, last_run_at: datetime, ffwd: type = ffwd) -> timedelta:
        """Estimate of next run time.

        Returns when the periodic task should run next as a
        :class:`~datetime.timedelta`.
        """
        # pylint: disable=redefined-outer-name
        # caching global ffwd
        return remaining(*self.remaining_delta(last_run_at, ffwd=ffwd))

    def is_due(self, last_run_at: datetime) -> tuple[bool, datetime]:
        """Return tuple of ``(is_due, next_time_to_run)``.

        If :setting:`beat_cron_starting_deadline`  has been specified, the
        scheduler will make sure that the `last_run_at` time is within the
        deadline. This prevents tasks that could have been run according to
        the crontab, but didn't, from running again unexpectedly.

        Note:
            Next time to run is in seconds.

        SeeAlso:
            :meth:`celery.schedules.schedule.is_due` for more information.
        """

        rem_delta = self.remaining_estimate(last_run_at)
        rem_secs = rem_delta.total_seconds()
        rem = max(rem_secs, 0)
        due = rem == 0

        deadline_secs = self.app.conf.beat_cron_starting_deadline
        has_passed_deadline = False
        if deadline_secs is not None:
            # Make sure we're looking at the latest possible feasible run
            # date when checking the deadline.
            last_date_checked = last_run_at
            last_feasible_rem_secs = rem_secs
            while rem_secs < 0:
                last_date_checked = last_date_checked + abs(rem_delta)
                rem_delta = self.remaining_estimate(last_date_checked)
                rem_secs = rem_delta.total_seconds()
                if rem_secs < 0:
                    last_feasible_rem_secs = rem_secs

            # if rem_secs becomes 0 or positive, second-to-last
            # last_date_checked must be the last feasible run date.
            # Check if the last feasible date is within the deadline
            # for running
            has_passed_deadline = -last_feasible_rem_secs > deadline_secs
            if has_passed_deadline:
                # Should not be due if we've passed the deadline for looking
                # at past runs
                due = False

        if due or has_passed_deadline:
            rem_delta = self.remaining_estimate(self.now())
            rem = max(rem_delta.total_seconds(), 0)
        return schedstate(due, rem)

    def __eq__(self, other: Any) -> bool:
        if isinstance(other, crontab):
            return (
                other.month_of_year == self.month_of_year and
                other.day_of_month == self.day_of_month and
                other.day_of_week == self.day_of_week and
                other.hour == self.hour and
                other.minute == self.minute and
                super().__eq__(other)
            )
        return NotImplemented


def maybe_schedule(
        s: int | float | timedelta | BaseSchedule, relative: bool = False,
        app: Celery | None = None) -> float | timedelta | BaseSchedule:
    """Return schedule from number, timedelta, or actual schedule."""
    if s is not None:
        if isinstance(s, (float, int)):
            s = timedelta(seconds=s)
        if isinstance(s, timedelta):
            return schedule(s, relative, app=app)
        else:
            s.app = app
    return s


class solar(BaseSchedule):
    """Solar event.

    A solar event can be used as the ``run_every`` value of a
    periodic task entry to schedule based on certain solar events.

    Notes:

        Available event values are:

            - ``dawn_astronomical``
            - ``dawn_nautical``
            - ``dawn_civil``
            - ``sunrise``
            - ``solar_noon``
            - ``sunset``
            - ``dusk_civil``
            - ``dusk_nautical``
            - ``dusk_astronomical``

    Arguments:
        event (str): Solar event that triggers this task.
            See note for available values.
        lat (float): The latitude of the observer.
        lon (float): The longitude of the observer.
        nowfun (Callable): Function returning the current date and time
            as a class:`~datetime.datetime`.
        app (Celery): Celery app instance.
    """

    _all_events = {
        'dawn_astronomical',
        'dawn_nautical',
        'dawn_civil',
        'sunrise',
        'solar_noon',
        'sunset',
        'dusk_civil',
        'dusk_nautical',
        'dusk_astronomical',
    }
    _horizons = {
        'dawn_astronomical': '-18',
        'dawn_nautical': '-12',
        'dawn_civil': '-6',
        'sunrise': '-0:34',
        'solar_noon': '0',
        'sunset': '-0:34',
        'dusk_civil': '-6',
        'dusk_nautical': '-12',
        'dusk_astronomical': '18',
    }
    _methods = {
        'dawn_astronomical': 'next_rising',
        'dawn_nautical': 'next_rising',
        'dawn_civil': 'next_rising',
        'sunrise': 'next_rising',
        'solar_noon': 'next_transit',
        'sunset': 'next_setting',
        'dusk_civil': 'next_setting',
        'dusk_nautical': 'next_setting',
        'dusk_astronomical': 'next_setting',
    }
    _use_center_l = {
        'dawn_astronomical': True,
        'dawn_nautical': True,
        'dawn_civil': True,
        'sunrise': False,
        'solar_noon': False,
        'sunset': False,
        'dusk_civil': True,
        'dusk_nautical': True,
        'dusk_astronomical': True,
    }

    def __init__(self, event: str, lat: int | float, lon: int | float, **
                 kwargs: Any) -> None:
        self.ephem = __import__('ephem')
        self.event = event
        self.lat = lat
        self.lon = lon
        super().__init__(**kwargs)

        if event not in self._all_events:
            raise ValueError(SOLAR_INVALID_EVENT.format(
                event=event, all_events=', '.join(sorted(self._all_events)),
            ))
        if lat < -90 or lat > 90:
            raise ValueError(SOLAR_INVALID_LATITUDE.format(lat=lat))
        if lon < -180 or lon > 180:
            raise ValueError(SOLAR_INVALID_LONGITUDE.format(lon=lon))

        cal = self.ephem.Observer()
        cal.lat = str(lat)
        cal.lon = str(lon)
        cal.elev = 0
        cal.horizon = self._horizons[event]
        cal.pressure = 0
        self.cal = cal

        self.method = self._methods[event]
        self.use_center = self._use_center_l[event]

    def __reduce__(self) -> tuple[type, tuple[str, int | float, int | float]]:
        return self.__class__, (self.event, self.lat, self.lon)

    def __repr__(self) -> str:
        return '<solar: {} at latitude {}, longitude: {}>'.format(
            self.event, self.lat, self.lon,
        )

    def remaining_estimate(self, last_run_at: datetime) -> timedelta:
        """Return estimate of next time to run.

        Returns:
            ~datetime.timedelta: when the periodic task should
                run next, or if it shouldn't run today (e.g., the sun does
                not rise today), returns the time when the next check
                should take place.
        """
        last_run_at = self.maybe_make_aware(last_run_at)
        last_run_at_utc = localize(last_run_at, timezone.utc)
        self.cal.date = last_run_at_utc
        try:
            if self.use_center:
                next_utc = getattr(self.cal, self.method)(
                    self.ephem.Sun(),
                    start=last_run_at_utc, use_center=self.use_center
                )
            else:
                next_utc = getattr(self.cal, self.method)(
                    self.ephem.Sun(), start=last_run_at_utc
                )

        except self.ephem.CircumpolarError:  # pragma: no cover
            # Sun won't rise/set today.  Check again tomorrow
            # (specifically, after the next anti-transit).
            next_utc = (
                self.cal.next_antitransit(self.ephem.Sun()) +
                timedelta(minutes=1)
            )
        next = self.maybe_make_aware(next_utc.datetime())
        now = self.maybe_make_aware(self.now())
        delta = next - now
        return delta

    def is_due(self, last_run_at: datetime) -> tuple[bool, datetime]:
        """Return tuple of ``(is_due, next_time_to_run)``.

        Note:
            next time to run is in seconds.

        See Also:
            :meth:`celery.schedules.schedule.is_due` for more information.
        """
        rem_delta = self.remaining_estimate(last_run_at)
        rem = max(rem_delta.total_seconds(), 0)
        due = rem == 0
        if due:
            rem_delta = self.remaining_estimate(self.now())
            rem = max(rem_delta.total_seconds(), 0)
        return schedstate(due, rem)

    def __eq__(self, other: Any) -> bool:
        if isinstance(other, solar):
            return (
                other.event == self.event and
                other.lat == self.lat and
                other.lon == self.lon
            )
        return NotImplemented
