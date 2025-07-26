# Copyright 2017 The Kubernetes Authors.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

import datetime
import math
import re


class TimezoneInfo(datetime.tzinfo):
    def __init__(self, h, m):
        self._name = "UTC"
        if h != 0 and m != 0:
            self._name += "%+03d:%2d" % (h, m)
        self._delta = datetime.timedelta(hours=h, minutes=math.copysign(m, h))

    def utcoffset(self, dt):
        return self._delta

    def tzname(self, dt):
        return self._name

    def dst(self, dt):
        return datetime.timedelta(0)


UTC = TimezoneInfo(0, 0)

# ref https://www.ietf.org/rfc/rfc3339.txt
_re_rfc3339 = re.compile(r"(\d\d\d\d)-(\d\d)-(\d\d)"        # full-date
                         r"[ Tt]"                           # Separator
                         r"(\d\d):(\d\d):(\d\d)([.,]\d+)?"  # partial-time
                         r"([zZ ]|[-+]\d\d?:\d\d)?",        # time-offset
                         re.VERBOSE + re.IGNORECASE)
_re_timezone = re.compile(r"([-+])(\d\d?):?(\d\d)?")

MICROSEC_PER_SEC = 1000000


def parse_rfc3339(s):
    if isinstance(s, datetime.datetime):
        # no need to parse it, just make sure it has a timezone.
        if not s.tzinfo:
            return s.replace(tzinfo=UTC)
        return s
    groups = _re_rfc3339.search(s).groups()
    dt = [0] * 7
    for x in range(6):
        dt[x] = int(groups[x])
    us = 0
    if groups[6] is not None:
        partial_sec = float(groups[6].replace(",", "."))
        us = int(MICROSEC_PER_SEC * partial_sec)
    tz = UTC
    if groups[7] is not None and groups[7] != 'Z' and groups[7] != 'z':
        tz_groups = _re_timezone.search(groups[7]).groups()
        hour = int(tz_groups[1])
        minute = 0
        if tz_groups[0] == "-":
            hour *= -1
        if tz_groups[2]:
            minute = int(tz_groups[2])
        tz = TimezoneInfo(hour, minute)
    return datetime.datetime(
        year=dt[0], month=dt[1], day=dt[2],
        hour=dt[3], minute=dt[4], second=dt[5],
        microsecond=us, tzinfo=tz)


def format_rfc3339(date_time):
    if date_time.tzinfo is None:
        date_time = date_time.replace(tzinfo=UTC)
    date_time = date_time.astimezone(UTC)
    return date_time.strftime('%Y-%m-%dT%H:%M:%SZ')
