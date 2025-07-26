# Copyright 2016 The Kubernetes Authors.
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

import unittest
from datetime import datetime

from .dateutil import UTC, TimezoneInfo, format_rfc3339, parse_rfc3339


class DateUtilTest(unittest.TestCase):

    def _parse_rfc3339_test(self, st, y, m, d, h, mn, s, us):
        actual = parse_rfc3339(st)
        expected = datetime(y, m, d, h, mn, s, us, UTC)
        self.assertEqual(expected, actual)

    def test_parse_rfc3339(self):
        self._parse_rfc3339_test("2017-07-25T04:44:21Z",
                                 2017, 7, 25, 4, 44, 21, 0)
        self._parse_rfc3339_test("2017-07-25 04:44:21Z",
                                 2017, 7, 25, 4, 44, 21, 0)
        self._parse_rfc3339_test("2017-07-25T04:44:21",
                                 2017, 7, 25, 4, 44, 21, 0)
        self._parse_rfc3339_test("2017-07-25T04:44:21z",
                                 2017, 7, 25, 4, 44, 21, 0)
        self._parse_rfc3339_test("2017-07-25T04:44:21+03:00",
                                 2017, 7, 25, 1, 44, 21, 0)
        self._parse_rfc3339_test("2017-07-25T04:44:21-03:00",
                                 2017, 7, 25, 7, 44, 21, 0)

        self._parse_rfc3339_test("2017-07-25T04:44:21,005Z",
                                 2017, 7, 25, 4, 44, 21, 5000)
        self._parse_rfc3339_test("2017-07-25T04:44:21.005Z",
                                 2017, 7, 25, 4, 44, 21, 5000)
        self._parse_rfc3339_test("2017-07-25 04:44:21.0050Z",
                                 2017, 7, 25, 4, 44, 21, 5000)
        self._parse_rfc3339_test("2017-07-25T04:44:21.5",
                                 2017, 7, 25, 4, 44, 21, 500000)
        self._parse_rfc3339_test("2017-07-25T04:44:21.005z",
                                 2017, 7, 25, 4, 44, 21, 5000)
        self._parse_rfc3339_test("2017-07-25T04:44:21.005+03:00",
                                 2017, 7, 25, 1, 44, 21, 5000)
        self._parse_rfc3339_test("2017-07-25T04:44:21.005-03:00",
                                 2017, 7, 25, 7, 44, 21, 5000)

    def test_format_rfc3339(self):
        self.assertEqual(
            format_rfc3339(datetime(2017, 7, 25, 4, 44, 21, 0, UTC)),
            "2017-07-25T04:44:21Z")
        self.assertEqual(
            format_rfc3339(datetime(2017, 7, 25, 4, 44, 21, 0,
                                    TimezoneInfo(2, 0))),
            "2017-07-25T02:44:21Z")
        self.assertEqual(
            format_rfc3339(datetime(2017, 7, 25, 4, 44, 21, 0,
                                    TimezoneInfo(-2, 30))),
            "2017-07-25T07:14:21Z")
