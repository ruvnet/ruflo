"""Parse ISO8601 dates.

Originally taken from :pypi:`pyiso8601`
(https://bitbucket.org/micktwomey/pyiso8601)

Modified to match the behavior of ``dateutil.parser``:

    - raise :exc:`ValueError` instead of ``ParseError``
    - return naive :class:`~datetime.datetime` by default

This is the original License:

Copyright (c) 2007 Michael Twomey

Permission is hereby granted, free of charge, to any person obtaining a
copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sub-license, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be included
in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
"""
import re
from datetime import datetime, timedelta, timezone

from celery.utils.deprecated import warn

__all__ = ('parse_iso8601',)

# Adapted from http://delete.me.uk/2005/03/iso8601.html
ISO8601_REGEX = re.compile(
    r'(?P<year>[0-9]{4})(-(?P<month>[0-9]{1,2})(-(?P<day>[0-9]{1,2})'
    r'((?P<separator>.)(?P<hour>[0-9]{2}):(?P<minute>[0-9]{2})'
    r'(:(?P<second>[0-9]{2})(\.(?P<fraction>[0-9]+))?)?'
    r'(?P<timezone>Z|(([-+])([0-9]{2}):([0-9]{2})))?)?)?)?'
)
TIMEZONE_REGEX = re.compile(
    r'(?P<prefix>[+-])(?P<hours>[0-9]{2}).(?P<minutes>[0-9]{2})'
)


def parse_iso8601(datestring):
    """Parse and convert ISO-8601 string to datetime."""
    warn("parse_iso8601", "v5.3", "v6", "datetime.datetime.fromisoformat")
    m = ISO8601_REGEX.match(datestring)
    if not m:
        raise ValueError('unable to parse date string %r' % datestring)
    groups = m.groupdict()
    tz = groups['timezone']
    if tz == 'Z':
        tz = timezone(timedelta(0))
    elif tz:
        m = TIMEZONE_REGEX.match(tz)
        prefix, hours, minutes = m.groups()
        hours, minutes = int(hours), int(minutes)
        if prefix == '-':
            hours = -hours
            minutes = -minutes
        tz = timezone(timedelta(minutes=minutes, hours=hours))
    return datetime(
        int(groups['year']), int(groups['month']),
        int(groups['day']), int(groups['hour'] or 0),
        int(groups['minute'] or 0), int(groups['second'] or 0),
        int(groups['fraction'] or 0), tz
    )
