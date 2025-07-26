# Human friendly input/output in Python.
#
# Author: Peter Odding <peter@peterodding.com>
# Last Change: September 17, 2021
# URL: https://humanfriendly.readthedocs.io

"""The main module of the `humanfriendly` package."""

# Standard library modules.
import collections
import datetime
import decimal
import numbers
import os
import os.path
import re
import time

# Modules included in our package.
from humanfriendly.compat import is_string, monotonic
from humanfriendly.deprecation import define_aliases
from humanfriendly.text import concatenate, format, pluralize, tokenize

# Public identifiers that require documentation.
__all__ = (
    'CombinedUnit',
    'InvalidDate',
    'InvalidLength',
    'InvalidSize',
    'InvalidTimespan',
    'SizeUnit',
    'Timer',
    '__version__',
    'coerce_boolean',
    'coerce_pattern',
    'coerce_seconds',
    'disk_size_units',
    'format_length',
    'format_number',
    'format_path',
    'format_size',
    'format_timespan',
    'length_size_units',
    'parse_date',
    'parse_length',
    'parse_path',
    'parse_size',
    'parse_timespan',
    'round_number',
    'time_units',
)

# Semi-standard module versioning.
__version__ = '10.0'

# Named tuples to define units of size.
SizeUnit = collections.namedtuple('SizeUnit', 'divider, symbol, name')
CombinedUnit = collections.namedtuple('CombinedUnit', 'decimal, binary')

# Common disk size units in binary (base-2) and decimal (base-10) multiples.
disk_size_units = (
    CombinedUnit(SizeUnit(1000**1, 'KB', 'kilobyte'), SizeUnit(1024**1, 'KiB', 'kibibyte')),
    CombinedUnit(SizeUnit(1000**2, 'MB', 'megabyte'), SizeUnit(1024**2, 'MiB', 'mebibyte')),
    CombinedUnit(SizeUnit(1000**3, 'GB', 'gigabyte'), SizeUnit(1024**3, 'GiB', 'gibibyte')),
    CombinedUnit(SizeUnit(1000**4, 'TB', 'terabyte'), SizeUnit(1024**4, 'TiB', 'tebibyte')),
    CombinedUnit(SizeUnit(1000**5, 'PB', 'petabyte'), SizeUnit(1024**5, 'PiB', 'pebibyte')),
    CombinedUnit(SizeUnit(1000**6, 'EB', 'exabyte'), SizeUnit(1024**6, 'EiB', 'exbibyte')),
    CombinedUnit(SizeUnit(1000**7, 'ZB', 'zettabyte'), SizeUnit(1024**7, 'ZiB', 'zebibyte')),
    CombinedUnit(SizeUnit(1000**8, 'YB', 'yottabyte'), SizeUnit(1024**8, 'YiB', 'yobibyte')),
)

# Common length size units, used for formatting and parsing.
length_size_units = (dict(prefix='nm', divider=1e-09, singular='nm', plural='nm'),
                     dict(prefix='mm', divider=1e-03, singular='mm', plural='mm'),
                     dict(prefix='cm', divider=1e-02, singular='cm', plural='cm'),
                     dict(prefix='m', divider=1, singular='metre', plural='metres'),
                     dict(prefix='km', divider=1000, singular='km', plural='km'))

# Common time units, used for formatting of time spans.
time_units = (dict(divider=1e-9, singular='nanosecond', plural='nanoseconds', abbreviations=['ns']),
              dict(divider=1e-6, singular='microsecond', plural='microseconds', abbreviations=['us']),
              dict(divider=1e-3, singular='millisecond', plural='milliseconds', abbreviations=['ms']),
              dict(divider=1, singular='second', plural='seconds', abbreviations=['s', 'sec', 'secs']),
              dict(divider=60, singular='minute', plural='minutes', abbreviations=['m', 'min', 'mins']),
              dict(divider=60 * 60, singular='hour', plural='hours', abbreviations=['h']),
              dict(divider=60 * 60 * 24, singular='day', plural='days', abbreviations=['d']),
              dict(divider=60 * 60 * 24 * 7, singular='week', plural='weeks', abbreviations=['w']),
              dict(divider=60 * 60 * 24 * 7 * 52, singular='year', plural='years', abbreviations=['y']))


def coerce_boolean(value):
    """
    Coerce any value to a boolean.

    :param value: Any Python value. If the value is a string:

                  - The strings '1', 'yes', 'true' and 'on' are coerced to :data:`True`.
                  - The strings '0', 'no', 'false' and 'off' are coerced to :data:`False`.
                  - Other strings raise an exception.

                  Other Python values are coerced using :class:`bool`.
    :returns: A proper boolean value.
    :raises: :exc:`exceptions.ValueError` when the value is a string but
             cannot be coerced with certainty.
    """
    if is_string(value):
        normalized = value.strip().lower()
        if normalized in ('1', 'yes', 'true', 'on'):
            return True
        elif normalized in ('0', 'no', 'false', 'off', ''):
            return False
        else:
            msg = "Failed to coerce string to boolean! (%r)"
            raise ValueError(format(msg, value))
    else:
        return bool(value)


def coerce_pattern(value, flags=0):
    """
    Coerce strings to compiled regular expressions.

    :param value: A string containing a regular expression pattern
                  or a compiled regular expression.
    :param flags: The flags used to compile the pattern (an integer).
    :returns: A compiled regular expression.
    :raises: :exc:`~exceptions.ValueError` when `value` isn't a string
             and also isn't a compiled regular expression.
    """
    if is_string(value):
        value = re.compile(value, flags)
    else:
        empty_pattern = re.compile('')
        pattern_type = type(empty_pattern)
        if not isinstance(value, pattern_type):
            msg = "Failed to coerce value to compiled regular expression! (%r)"
            raise ValueError(format(msg, value))
    return value


def coerce_seconds(value):
    """
    Coerce a value to the number of seconds.

    :param value: An :class:`int`, :class:`float` or
                  :class:`datetime.timedelta` object.
    :returns: An :class:`int` or :class:`float` value.

    When `value` is a :class:`datetime.timedelta` object the
    :meth:`~datetime.timedelta.total_seconds()` method is called.
    """
    if isinstance(value, datetime.timedelta):
        return value.total_seconds()
    if not isinstance(value, numbers.Number):
        msg = "Failed to coerce value to number of seconds! (%r)"
        raise ValueError(format(msg, value))
    return value


def format_size(num_bytes, keep_width=False, binary=False):
    """
    Format a byte count as a human readable file size.

    :param num_bytes: The size to format in bytes (an integer).
    :param keep_width: :data:`True` if trailing zeros should not be stripped,
                       :data:`False` if they can be stripped.
    :param binary: :data:`True` to use binary multiples of bytes (base-2),
                   :data:`False` to use decimal multiples of bytes (base-10).
    :returns: The corresponding human readable file size (a string).

    This function knows how to format sizes in bytes, kilobytes, megabytes,
    gigabytes, terabytes and petabytes. Some examples:

    >>> from humanfriendly import format_size
    >>> format_size(0)
    '0 bytes'
    >>> format_size(1)
    '1 byte'
    >>> format_size(5)
    '5 bytes'
    > format_size(1000)
    '1 KB'
    > format_size(1024, binary=True)
    '1 KiB'
    >>> format_size(1000 ** 3 * 4)
    '4 GB'
    """
    for unit in reversed(disk_size_units):
        if num_bytes >= unit.binary.divider and binary:
            number = round_number(float(num_bytes) / unit.binary.divider, keep_width=keep_width)
            return pluralize(number, unit.binary.symbol, unit.binary.symbol)
        elif num_bytes >= unit.decimal.divider and not binary:
            number = round_number(float(num_bytes) / unit.decimal.divider, keep_width=keep_width)
            return pluralize(number, unit.decimal.symbol, unit.decimal.symbol)
    return pluralize(num_bytes, 'byte')


def parse_size(size, binary=False):
    """
    Parse a human readable data size and return the number of bytes.

    :param size: The human readable file size to parse (a string).
    :param binary: :data:`True` to use binary multiples of bytes (base-2) for
                   ambiguous unit symbols and names, :data:`False` to use
                   decimal multiples of bytes (base-10).
    :returns: The corresponding size in bytes (an integer).
    :raises: :exc:`InvalidSize` when the input can't be parsed.

    This function knows how to parse sizes in bytes, kilobytes, megabytes,
    gigabytes, terabytes and petabytes. Some examples:

    >>> from humanfriendly import parse_size
    >>> parse_size('42')
    42
    >>> parse_size('13b')
    13
    >>> parse_size('5 bytes')
    5
    >>> parse_size('1 KB')
    1000
    >>> parse_size('1 kilobyte')
    1000
    >>> parse_size('1 KiB')
    1024
    >>> parse_size('1 KB', binary=True)
    1024
    >>> parse_size('1.5 GB')
    1500000000
    >>> parse_size('1.5 GB', binary=True)
    1610612736
    """
    tokens = tokenize(size)
    if tokens and isinstance(tokens[0], numbers.Number):
        # Get the normalized unit (if any) from the tokenized input.
        normalized_unit = tokens[1].lower() if len(tokens) == 2 and is_string(tokens[1]) else ''
        # If the input contains only a number, it's assumed to be the number of
        # bytes. The second token can also explicitly reference the unit bytes.
        if len(tokens) == 1 or normalized_unit.startswith('b'):
            return int(tokens[0])
        # Otherwise we expect two tokens: A number and a unit.
        if normalized_unit:
            # Convert plural units to singular units, for details:
            # https://github.com/xolox/python-humanfriendly/issues/26
            normalized_unit = normalized_unit.rstrip('s')
            for unit in disk_size_units:
                # First we check for unambiguous symbols (KiB, MiB, GiB, etc)
                # and names (kibibyte, mebibyte, gibibyte, etc) because their
                # handling is always the same.
                if normalized_unit in (unit.binary.symbol.lower(), unit.binary.name.lower()):
                    return int(tokens[0] * unit.binary.divider)
                # Now we will deal with ambiguous prefixes (K, M, G, etc),
                # symbols (KB, MB, GB, etc) and names (kilobyte, megabyte,
                # gigabyte, etc) according to the caller's preference.
                if (normalized_unit in (unit.decimal.symbol.lower(), unit.decimal.name.lower()) or
                        normalized_unit.startswith(unit.decimal.symbol[0].lower())):
                    return int(tokens[0] * (unit.binary.divider if binary else unit.decimal.divider))
    # We failed to parse the size specification.
    msg = "Failed to parse size! (input %r was tokenized as %r)"
    raise InvalidSize(format(msg, size, tokens))


def format_length(num_metres, keep_width=False):
    """
    Format a metre count as a human readable length.

    :param num_metres: The length to format in metres (float / integer).
    :param keep_width: :data:`True` if trailing zeros should not be stripped,
                       :data:`False` if they can be stripped.
    :returns: The corresponding human readable length (a string).

    This function supports ranges from nanometres to kilometres.

    Some examples:

    >>> from humanfriendly import format_length
    >>> format_length(0)
    '0 metres'
    >>> format_length(1)
    '1 metre'
    >>> format_length(5)
    '5 metres'
    >>> format_length(1000)
    '1 km'
    >>> format_length(0.004)
    '4 mm'
    """
    for unit in reversed(length_size_units):
        if num_metres >= unit['divider']:
            number = round_number(float(num_metres) / unit['divider'], keep_width=keep_width)
            return pluralize(number, unit['singular'], unit['plural'])
    return pluralize(num_metres, 'metre')


def parse_length(length):
    """
    Parse a human readable length and return the number of metres.

    :param length: The human readable length to parse (a string).
    :returns: The corresponding length in metres (a float).
    :raises: :exc:`InvalidLength` when the input can't be parsed.

    Some examples:

    >>> from humanfriendly import parse_length
    >>> parse_length('42')
    42
    >>> parse_length('1 km')
    1000
    >>> parse_length('5mm')
    0.005
    >>> parse_length('15.3cm')
    0.153
    """
    tokens = tokenize(length)
    if tokens and isinstance(tokens[0], numbers.Number):
        # If the input contains only a number, it's assumed to be the number of metres.
        if len(tokens) == 1:
            return tokens[0]
        # Otherwise we expect to find two tokens: A number and a unit.
        if len(tokens) == 2 and is_string(tokens[1]):
            normalized_unit = tokens[1].lower()
            # Try to match the first letter of the unit.
            for unit in length_size_units:
                if normalized_unit.startswith(unit['prefix']):
                    return tokens[0] * unit['divider']
    # We failed to parse the length specification.
    msg = "Failed to parse length! (input %r was tokenized as %r)"
    raise InvalidLength(format(msg, length, tokens))


def format_number(number, num_decimals=2):
    """
    Format a number as a string including thousands separators.

    :param number: The number to format (a number like an :class:`int`,
                   :class:`long` or :class:`float`).
    :param num_decimals: The number of decimals to render (2 by default). If no
                         decimal places are required to represent the number
                         they will be omitted regardless of this argument.
    :returns: The formatted number (a string).

    This function is intended to make it easier to recognize the order of size
    of the number being formatted.

    Here's an example:

    >>> from humanfriendly import format_number
    >>> print(format_number(6000000))
    6,000,000
    > print(format_number(6000000000.42))
    6,000,000,000.42
    > print(format_number(6000000000.42, num_decimals=0))
    6,000,000,000
    """
    integer_part, _, decimal_part = str(float(number)).partition('.')
    negative_sign = integer_part.startswith('-')
    reversed_digits = ''.join(reversed(integer_part.lstrip('-')))
    parts = []
    while reversed_digits:
        parts.append(reversed_digits[:3])
        reversed_digits = reversed_digits[3:]
    formatted_number = ''.join(reversed(','.join(parts)))
    decimals_to_add = decimal_part[:num_decimals].rstrip('0')
    if decimals_to_add:
        formatted_number += '.' + decimals_to_add
    if negative_sign:
        formatted_number = '-' + formatted_number
    return formatted_number


def round_number(count, keep_width=False):
    """
    Round a floating point number to two decimal places in a human friendly format.

    :param count: The number to format.
    :param keep_width: :data:`True` if trailing zeros should not be stripped,
                       :data:`False` if they can be stripped.
    :returns: The formatted number as a string. If no decimal places are
              required to represent the number, they will be omitted.

    The main purpose of this function is to be used by functions like
    :func:`format_length()`, :func:`format_size()` and
    :func:`format_timespan()`.

    Here are some examples:

    >>> from humanfriendly import round_number
    >>> round_number(1)
    '1'
    >>> round_number(math.pi)
    '3.14'
    >>> round_number(5.001)
    '5'
    """
    text = '%.2f' % float(count)
    if not keep_width:
        text = re.sub('0+$', '', text)
        text = re.sub(r'\.$', '', text)
    return text


def format_timespan(num_seconds, detailed=False, max_units=3):
    """
    Format a timespan in seconds as a human readable string.

    :param num_seconds: Any value accepted by :func:`coerce_seconds()`.
    :param detailed: If :data:`True` milliseconds are represented separately
                     instead of being represented as fractional seconds
                     (defaults to :data:`False`).
    :param max_units: The maximum number of units to show in the formatted time
                      span (an integer, defaults to three).
    :returns: The formatted timespan as a string.
    :raise: See :func:`coerce_seconds()`.

    Some examples:

    >>> from humanfriendly import format_timespan
    >>> format_timespan(0)
    '0 seconds'
    >>> format_timespan(1)
    '1 second'
    >>> import math
    >>> format_timespan(math.pi)
    '3.14 seconds'
    >>> hour = 60 * 60
    >>> day = hour * 24
    >>> week = day * 7
    >>> format_timespan(week * 52 + day * 2 + hour * 3)
    '1 year, 2 days and 3 hours'
    """
    num_seconds = coerce_seconds(num_seconds)
    if num_seconds < 60 and not detailed:
        # Fast path.
        return pluralize(round_number(num_seconds), 'second')
    else:
        # Slow path.
        result = []
        num_seconds = decimal.Decimal(str(num_seconds))
        relevant_units = list(reversed(time_units[0 if detailed else 3:]))
        for unit in relevant_units:
            # Extract the unit count from the remaining time.
            divider = decimal.Decimal(str(unit['divider']))
            count = num_seconds / divider
            num_seconds %= divider
            # Round the unit count appropriately.
            if unit != relevant_units[-1]:
                # Integer rounding for all but the smallest unit.
                count = int(count)
            else:
                # Floating point rounding for the smallest unit.
                count = round_number(count)
            # Only include relevant units in the result.
            if count not in (0, '0'):
                result.append(pluralize(count, unit['singular'], unit['plural']))
        if len(result) == 1:
            # A single count/unit combination.
            return result[0]
        else:
            if not detailed:
                # Remove `insignificant' data from the formatted timespan.
                result = result[:max_units]
            # Format the timespan in a readable way.
            return concatenate(result)


def parse_timespan(timespan):
    """
    Parse a "human friendly" timespan into the number of seconds.

    :param value: A string like ``5h`` (5 hours), ``10m`` (10 minutes) or
                  ``42s`` (42 seconds).
    :returns: The number of seconds as a floating point number.
    :raises: :exc:`InvalidTimespan` when the input can't be parsed.

    Note that the :func:`parse_timespan()` function is not meant to be the
    "mirror image" of the :func:`format_timespan()` function. Instead it's
    meant to allow humans to easily and succinctly specify a timespan with a
    minimal amount of typing. It's very useful to accept easy to write time
    spans as e.g. command line arguments to programs.

    The time units (and abbreviations) supported by this function are:

    - ms, millisecond, milliseconds
    - s, sec, secs, second, seconds
    - m, min, mins, minute, minutes
    - h, hour, hours
    - d, day, days
    - w, week, weeks
    - y, year, years

    Some examples:

    >>> from humanfriendly import parse_timespan
    >>> parse_timespan('42')
    42.0
    >>> parse_timespan('42s')
    42.0
    >>> parse_timespan('1m')
    60.0
    >>> parse_timespan('1h')
    3600.0
    >>> parse_timespan('1d')
    86400.0
    """
    tokens = tokenize(timespan)
    if tokens and isinstance(tokens[0], numbers.Number):
        # If the input contains only a number, it's assumed to be the number of seconds.
        if len(tokens) == 1:
            return float(tokens[0])
        # Otherwise we expect to find two tokens: A number and a unit.
        if len(tokens) == 2 and is_string(tokens[1]):
            normalized_unit = tokens[1].lower()
            for unit in time_units:
                if (normalized_unit == unit['singular'] or
                        normalized_unit == unit['plural'] or
                        normalized_unit in unit['abbreviations']):
                    return float(tokens[0]) * unit['divider']
    # We failed to parse the timespan specification.
    msg = "Failed to parse timespan! (input %r was tokenized as %r)"
    raise InvalidTimespan(format(msg, timespan, tokens))


def parse_date(datestring):
    """
    Parse a date/time string into a tuple of integers.

    :param datestring: The date/time string to parse.
    :returns: A tuple with the numbers ``(year, month, day, hour, minute,
              second)`` (all numbers are integers).
    :raises: :exc:`InvalidDate` when the date cannot be parsed.

    Supported date/time formats:

    - ``YYYY-MM-DD``
    - ``YYYY-MM-DD HH:MM:SS``

    .. note:: If you want to parse date/time strings with a fixed, known
              format and :func:`parse_date()` isn't useful to you, consider
              :func:`time.strptime()` or :meth:`datetime.datetime.strptime()`,
              both of which are included in the Python standard library.
              Alternatively for more complex tasks consider using the date/time
              parsing module in the dateutil_ package.

    Examples:

    >>> from humanfriendly import parse_date
    >>> parse_date('2013-06-17')
    (2013, 6, 17, 0, 0, 0)
    >>> parse_date('2013-06-17 02:47:42')
    (2013, 6, 17, 2, 47, 42)

    Here's how you convert the result to a number (`Unix time`_):

    >>> from humanfriendly import parse_date
    >>> from time import mktime
    >>> mktime(parse_date('2013-06-17 02:47:42') + (-1, -1, -1))
    1371430062.0

    And here's how you convert it to a :class:`datetime.datetime` object:

    >>> from humanfriendly import parse_date
    >>> from datetime import datetime
    >>> datetime(*parse_date('2013-06-17 02:47:42'))
    datetime.datetime(2013, 6, 17, 2, 47, 42)

    Here's an example that combines :func:`format_timespan()` and
    :func:`parse_date()` to calculate a human friendly timespan since a
    given date:

    >>> from humanfriendly import format_timespan, parse_date
    >>> from time import mktime, time
    >>> unix_time = mktime(parse_date('2013-06-17 02:47:42') + (-1, -1, -1))
    >>> seconds_since_then = time() - unix_time
    >>> print(format_timespan(seconds_since_then))
    1 year, 43 weeks and 1 day

    .. _dateutil: https://dateutil.readthedocs.io/en/latest/parser.html
    .. _Unix time: http://en.wikipedia.org/wiki/Unix_time
    """
    try:
        tokens = [t.strip() for t in datestring.split()]
        if len(tokens) >= 2:
            date_parts = list(map(int, tokens[0].split('-'))) + [1, 1]
            time_parts = list(map(int, tokens[1].split(':'))) + [0, 0, 0]
            return tuple(date_parts[0:3] + time_parts[0:3])
        else:
            year, month, day = (list(map(int, datestring.split('-'))) + [1, 1])[0:3]
            return (year, month, day, 0, 0, 0)
    except Exception:
        msg = "Invalid date! (expected 'YYYY-MM-DD' or 'YYYY-MM-DD HH:MM:SS' but got: %r)"
        raise InvalidDate(format(msg, datestring))


def format_path(pathname):
    """
    Shorten a pathname to make it more human friendly.

    :param pathname: An absolute pathname (a string).
    :returns: The pathname with the user's home directory abbreviated.

    Given an absolute pathname, this function abbreviates the user's home
    directory to ``~/`` in order to shorten the pathname without losing
    information. It is not an error if the pathname is not relative to the
    current user's home directory.

    Here's an example of its usage:

    >>> from os import environ
    >>> from os.path import join
    >>> vimrc = join(environ['HOME'], '.vimrc')
    >>> vimrc
    '/home/peter/.vimrc'
    >>> from humanfriendly import format_path
    >>> format_path(vimrc)
    '~/.vimrc'
    """
    pathname = os.path.abspath(pathname)
    home = os.environ.get('HOME')
    if home:
        home = os.path.abspath(home)
        if pathname.startswith(home):
            pathname = os.path.join('~', os.path.relpath(pathname, home))
    return pathname


def parse_path(pathname):
    """
    Convert a human friendly pathname to an absolute pathname.

    Expands leading tildes using :func:`os.path.expanduser()` and
    environment variables using :func:`os.path.expandvars()` and makes the
    resulting pathname absolute using :func:`os.path.abspath()`.

    :param pathname: A human friendly pathname (a string).
    :returns: An absolute pathname (a string).
    """
    return os.path.abspath(os.path.expanduser(os.path.expandvars(pathname)))


class Timer(object):

    """
    Easy to use timer to keep track of long during operations.
    """

    def __init__(self, start_time=None, resumable=False):
        """
        Remember the time when the :class:`Timer` was created.

        :param start_time: The start time (a float, defaults to the current time).
        :param resumable: Create a resumable timer (defaults to :data:`False`).

        When `start_time` is given :class:`Timer` uses :func:`time.time()` as a
        clock source, otherwise it uses :func:`humanfriendly.compat.monotonic()`.
        """
        if resumable:
            self.monotonic = True
            self.resumable = True
            self.start_time = 0.0
            self.total_time = 0.0
        elif start_time:
            self.monotonic = False
            self.resumable = False
            self.start_time = start_time
        else:
            self.monotonic = True
            self.resumable = False
            self.start_time = monotonic()

    def __enter__(self):
        """
        Start or resume counting elapsed time.

        :returns: The :class:`Timer` object.
        :raises: :exc:`~exceptions.ValueError` when the timer isn't resumable.
        """
        if not self.resumable:
            raise ValueError("Timer is not resumable!")
        self.start_time = monotonic()
        return self

    def __exit__(self, exc_type=None, exc_value=None, traceback=None):
        """
        Stop counting elapsed time.

        :raises: :exc:`~exceptions.ValueError` when the timer isn't resumable.
        """
        if not self.resumable:
            raise ValueError("Timer is not resumable!")
        if self.start_time:
            self.total_time += monotonic() - self.start_time
            self.start_time = 0.0

    def sleep(self, seconds):
        """
        Easy to use rate limiting of repeating actions.

        :param seconds: The number of seconds to sleep (an
                        integer or floating point number).

        This method sleeps for the given number of seconds minus the
        :attr:`elapsed_time`. If the resulting duration is negative
        :func:`time.sleep()` will still be called, but the argument
        given to it will be the number 0 (negative numbers cause
        :func:`time.sleep()` to raise an exception).

        The use case for this is to initialize a :class:`Timer` inside
        the body of a :keyword:`for` or :keyword:`while` loop and call
        :func:`Timer.sleep()` at the end of the loop body to rate limit
        whatever it is that is being done inside the loop body.

        For posterity: Although the implementation of :func:`sleep()` only
        requires a single line of code I've added it to :mod:`humanfriendly`
        anyway because now that I've thought about how to tackle this once I
        never want to have to think about it again :-P (unless I find ways to
        improve this).
        """
        time.sleep(max(0, seconds - self.elapsed_time))

    @property
    def elapsed_time(self):
        """
        Get the number of seconds counted so far.
        """
        elapsed_time = 0
        if self.resumable:
            elapsed_time += self.total_time
        if self.start_time:
            current_time = monotonic() if self.monotonic else time.time()
            elapsed_time += current_time - self.start_time
        return elapsed_time

    @property
    def rounded(self):
        """Human readable timespan rounded to seconds (a string)."""
        return format_timespan(round(self.elapsed_time))

    def __str__(self):
        """Show the elapsed time since the :class:`Timer` was created."""
        return format_timespan(self.elapsed_time)


class InvalidDate(Exception):

    """
    Raised when a string cannot be parsed into a date.

    For example:

    >>> from humanfriendly import parse_date
    >>> parse_date('2013-06-XY')
    Traceback (most recent call last):
      File "humanfriendly.py", line 206, in parse_date
        raise InvalidDate(format(msg, datestring))
    humanfriendly.InvalidDate: Invalid date! (expected 'YYYY-MM-DD' or 'YYYY-MM-DD HH:MM:SS' but got: '2013-06-XY')
    """


class InvalidSize(Exception):

    """
    Raised when a string cannot be parsed into a file size.

    For example:

    >>> from humanfriendly import parse_size
    >>> parse_size('5 Z')
    Traceback (most recent call last):
      File "humanfriendly/__init__.py", line 267, in parse_size
        raise InvalidSize(format(msg, size, tokens))
    humanfriendly.InvalidSize: Failed to parse size! (input '5 Z' was tokenized as [5, 'Z'])
    """


class InvalidLength(Exception):

    """
    Raised when a string cannot be parsed into a length.

    For example:

    >>> from humanfriendly import parse_length
    >>> parse_length('5 Z')
    Traceback (most recent call last):
      File "humanfriendly/__init__.py", line 267, in parse_length
        raise InvalidLength(format(msg, length, tokens))
    humanfriendly.InvalidLength: Failed to parse length! (input '5 Z' was tokenized as [5, 'Z'])
    """


class InvalidTimespan(Exception):

    """
    Raised when a string cannot be parsed into a timespan.

    For example:

    >>> from humanfriendly import parse_timespan
    >>> parse_timespan('1 age')
    Traceback (most recent call last):
      File "humanfriendly/__init__.py", line 419, in parse_timespan
        raise InvalidTimespan(format(msg, timespan, tokens))
    humanfriendly.InvalidTimespan: Failed to parse timespan! (input '1 age' was tokenized as [1, 'age'])
    """


# Define aliases for backwards compatibility.
define_aliases(
    module_name=__name__,
    # In humanfriendly 1.23 the format_table() function was added to render a
    # table using characters like dashes and vertical bars to emulate borders.
    # Since then support for other tables has been added and the name of
    # format_table() has changed.
    format_table='humanfriendly.tables.format_pretty_table',
    # In humanfriendly 1.30 the following text manipulation functions were
    # moved out into a separate module to enable their usage in other modules
    # of the humanfriendly package (without causing circular imports).
    compact='humanfriendly.text.compact',
    concatenate='humanfriendly.text.concatenate',
    dedent='humanfriendly.text.dedent',
    format='humanfriendly.text.format',
    is_empty_line='humanfriendly.text.is_empty_line',
    pluralize='humanfriendly.text.pluralize',
    tokenize='humanfriendly.text.tokenize',
    trim_empty_lines='humanfriendly.text.trim_empty_lines',
    # In humanfriendly 1.38 the prompt_for_choice() function was moved out into a
    # separate module because several variants of interactive prompts were added.
    prompt_for_choice='humanfriendly.prompts.prompt_for_choice',
    # In humanfriendly 8.0 the Spinner class and minimum_spinner_interval
    # variable were extracted to a new module and the erase_line_code,
    # hide_cursor_code and show_cursor_code variables were moved.
    AutomaticSpinner='humanfriendly.terminal.spinners.AutomaticSpinner',
    Spinner='humanfriendly.terminal.spinners.Spinner',
    erase_line_code='humanfriendly.terminal.ANSI_ERASE_LINE',
    hide_cursor_code='humanfriendly.terminal.ANSI_SHOW_CURSOR',
    minimum_spinner_interval='humanfriendly.terminal.spinners.MINIMUM_INTERVAL',
    show_cursor_code='humanfriendly.terminal.ANSI_HIDE_CURSOR',
)
