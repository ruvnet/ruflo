# coding=utf-8
# Copyright 2022-present, the HuggingFace Inc. team.
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
"""Contains utilities to handle datetimes in Huggingface Hub."""

from datetime import datetime, timezone


def parse_datetime(date_string: str) -> datetime:
    """
    Parses a date_string returned from the server to a datetime object.

    This parser is a weak-parser is the sense that it handles only a single format of
    date_string. It is expected that the server format will never change. The
    implementation depends only on the standard lib to avoid an external dependency
    (python-dateutil). See full discussion about this decision on PR:
    https://github.com/huggingface/huggingface_hub/pull/999.

    Example:
        ```py
        > parse_datetime('2022-08-19T07:19:38.123Z')
        datetime.datetime(2022, 8, 19, 7, 19, 38, 123000, tzinfo=timezone.utc)
        ```

    Args:
        date_string (`str`):
            A string representing a datetime returned by the Hub server.
            String is expected to follow '%Y-%m-%dT%H:%M:%S.%fZ' pattern.

    Returns:
        A python datetime object.

    Raises:
        :class:`ValueError`:
            If `date_string` cannot be parsed.
    """
    try:
        # Normalize the string to always have 6 digits of fractional seconds
        if date_string.endswith("Z"):
            # Case 1: No decimal point (e.g., "2024-11-16T00:27:02Z")
            if "." not in date_string:
                # No fractional seconds - insert .000000
                date_string = date_string[:-1] + ".000000Z"
            # Case 2: Has decimal point (e.g., "2022-08-19T07:19:38.123456789Z")
            else:
                # Get the fractional and base parts
                base, fraction = date_string[:-1].split(".")
                # fraction[:6] takes first 6 digits and :0<6 pads with zeros if less than 6 digits
                date_string = f"{base}.{fraction[:6]:0<6}Z"

        return datetime.strptime(date_string, "%Y-%m-%dT%H:%M:%S.%fZ").replace(tzinfo=timezone.utc)
    except ValueError as e:
        raise ValueError(
            f"Cannot parse '{date_string}' as a datetime. Date string is expected to"
            " follow '%Y-%m-%dT%H:%M:%S.%fZ' pattern."
        ) from e
