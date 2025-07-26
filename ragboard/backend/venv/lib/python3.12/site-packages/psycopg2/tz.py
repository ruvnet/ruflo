"""tzinfo implementations for psycopg2

This module holds two different tzinfo implementations that can be used as
the 'tzinfo' argument to datetime constructors, directly passed to psycopg
functions or used to set the .tzinfo_factory attribute in cursors.
"""
# psycopg/tz.py - tzinfo implementation
#
# Copyright (C) 2003-2019 Federico Di Gregorio  <fog@debian.org>
# Copyright (C) 2020-2021 The Psycopg Team
#
# psycopg2 is free software: you can redistribute it and/or modify it
# under the terms of the GNU Lesser General Public License as published
# by the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
#
# In addition, as a special exception, the copyright holders give
# permission to link this program with the OpenSSL library (or with
# modified versions of OpenSSL that use the same license as OpenSSL),
# and distribute linked combinations including the two.
#
# You must obey the GNU Lesser General Public License in all respects for
# all of the code used other than OpenSSL.
#
# psycopg2 is distributed in the hope that it will be useful, but WITHOUT
# ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or
# FITNESS FOR A PARTICULAR PURPOSE.  See the GNU Lesser General Public
# License for more details.

import datetime
import time

ZERO = datetime.timedelta(0)


class FixedOffsetTimezone(datetime.tzinfo):
    """Fixed offset in minutes east from UTC.

    This is exactly the implementation__ found in Python 2.3.x documentation,
    with a small change to the `!__init__()` method to allow for pickling
    and a default name in the form ``sHH:MM`` (``s`` is the sign.).

    The implementation also caches instances. During creation, if a
    FixedOffsetTimezone instance has previously been created with the same
    offset and name that instance will be returned. This saves memory and
    improves comparability.

    .. versionchanged:: 2.9

        The constructor can take either a timedelta or a number of minutes of
        offset. Previously only minutes were supported.

    .. __: https://docs.python.org/library/datetime.html
    """
    _name = None
    _offset = ZERO

    _cache = {}

    def __init__(self, offset=None, name=None):
        if offset is not None:
            if not isinstance(offset, datetime.timedelta):
                offset = datetime.timedelta(minutes=offset)
            self._offset = offset
        if name is not None:
            self._name = name

    def __new__(cls, offset=None, name=None):
        """Return a suitable instance created earlier if it exists
        """
        key = (offset, name)
        try:
            return cls._cache[key]
        except KeyError:
            tz = super().__new__(cls, offset, name)
            cls._cache[key] = tz
            return tz

    def __repr__(self):
        return "psycopg2.tz.FixedOffsetTimezone(offset=%r, name=%r)" \
            % (self._offset, self._name)

    def __eq__(self, other):
        if isinstance(other, FixedOffsetTimezone):
            return self._offset == other._offset
        else:
            return NotImplemented

    def __ne__(self, other):
        if isinstance(other, FixedOffsetTimezone):
            return self._offset != other._offset
        else:
            return NotImplemented

    def __getinitargs__(self):
        return self._offset, self._name

    def utcoffset(self, dt):
        return self._offset

    def tzname(self, dt):
        if self._name is not None:
            return self._name

        minutes, seconds = divmod(self._offset.total_seconds(), 60)
        hours, minutes = divmod(minutes, 60)
        rv = "%+03d" % hours
        if minutes or seconds:
            rv += ":%02d" % minutes
            if seconds:
                rv += ":%02d" % seconds

        return rv

    def dst(self, dt):
        return ZERO


STDOFFSET = datetime.timedelta(seconds=-time.timezone)
if time.daylight:
    DSTOFFSET = datetime.timedelta(seconds=-time.altzone)
else:
    DSTOFFSET = STDOFFSET
DSTDIFF = DSTOFFSET - STDOFFSET


class LocalTimezone(datetime.tzinfo):
    """Platform idea of local timezone.

    This is the exact implementation from the Python 2.3 documentation.
    """
    def utcoffset(self, dt):
        if self._isdst(dt):
            return DSTOFFSET
        else:
            return STDOFFSET

    def dst(self, dt):
        if self._isdst(dt):
            return DSTDIFF
        else:
            return ZERO

    def tzname(self, dt):
        return time.tzname[self._isdst(dt)]

    def _isdst(self, dt):
        tt = (dt.year, dt.month, dt.day,
              dt.hour, dt.minute, dt.second,
              dt.weekday(), 0, -1)
        stamp = time.mktime(tt)
        tt = time.localtime(stamp)
        return tt.tm_isdst > 0


LOCAL = LocalTimezone()

# TODO: pre-generate some interesting time zones?
