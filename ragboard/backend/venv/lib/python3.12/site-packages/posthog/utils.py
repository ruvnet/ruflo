import logging
import numbers
import re
from collections import defaultdict
from dataclasses import asdict, is_dataclass
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Any, Optional
from uuid import UUID

import six
from dateutil.tz import tzlocal, tzutc

log = logging.getLogger("posthog")


def is_naive(dt):
    """Determines if a given datetime.datetime is naive."""
    return dt.tzinfo is None or dt.tzinfo.utcoffset(dt) is None


def total_seconds(delta):
    """Determines total seconds with python < 2.7 compat."""
    # http://stackoverflow.com/questions/3694835/python-2-6-5-divide-timedelta-with-timedelta
    return (delta.microseconds + (delta.seconds + delta.days * 24 * 3600) * 1e6) / 1e6


def guess_timezone(dt):
    """Attempts to convert a naive datetime to an aware datetime."""
    if is_naive(dt):
        # attempts to guess the datetime.datetime.now() local timezone
        # case, and then defaults to utc
        delta = datetime.now() - dt
        if total_seconds(delta) < 5:
            # this was created using datetime.datetime.now()
            # so we are in the local timezone
            return dt.replace(tzinfo=tzlocal())
        else:
            # at this point, the best we can do is guess UTC
            return dt.replace(tzinfo=tzutc())

    return dt


def remove_trailing_slash(host):
    if host.endswith("/"):
        return host[:-1]
    return host


def clean(item):
    if isinstance(item, Decimal):
        return float(item)
    if isinstance(item, UUID):
        return str(item)
    if isinstance(
        item, (six.string_types, bool, numbers.Number, datetime, date, type(None))
    ):
        return item
    if isinstance(item, (set, list, tuple)):
        return _clean_list(item)
    # Pydantic model
    try:
        # v2+
        if hasattr(item, "model_dump") and callable(item.model_dump):
            item = item.model_dump()
        # v1
        elif hasattr(item, "dict") and callable(item.dict):
            item = item.dict()
    except TypeError as e:
        log.debug(f"Could not serialize Pydantic-like model: {e}")
        pass
    if isinstance(item, dict):
        return _clean_dict(item)
    if is_dataclass(item) and not isinstance(item, type):
        return _clean_dataclass(item)
    return _coerce_unicode(item)


def _clean_list(list_):
    return [clean(item) for item in list_]


def _clean_dict(dict_):
    data = {}
    for k, v in six.iteritems(dict_):
        try:
            data[k] = clean(v)
        except TypeError:
            log.warning(
                'Dictionary values must be serializeable to JSON "%s" value %s of type %s is unsupported.',
                k,
                v,
                type(v),
            )
    return data


def _clean_dataclass(dataclass_):
    data = asdict(dataclass_)
    data = _clean_dict(data)
    return data


def _coerce_unicode(cmplx: Any) -> Optional[str]:
    """
    In theory, this method is only called
    after many isinstance checks are carried out in `utils.clean`.
    When we supported Python 2 it was safe to call `decode` on a `str`
    but in Python 3 that will throw.
    So, we check if the input is bytes and only call `decode` in that case.

    Previously we would always call `decode` on the input
    That would throw an error.
    Then we would call `decode` on the stringified error
    That would throw an error.
    And then we would return `None`

    To avoid a breaking change, we can maintain the behavior
    that anything which did not have `decode` in Python 2
    returns None.
    """
    item = None
    try:
        if isinstance(cmplx, bytes):
            item = cmplx.decode("utf-8", "strict")
        elif isinstance(cmplx, str):
            item = cmplx
    except Exception as exception:
        item = ":".join(map(str, exception.args))
        log.warning("Error decoding: %s", item)
        return None

    return item


def is_valid_regex(value) -> bool:
    try:
        re.compile(value)
        return True
    except re.error:
        return False


class SizeLimitedDict(defaultdict):
    def __init__(self, max_size, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.max_size = max_size

    def __setitem__(self, key, value):
        if len(self) >= self.max_size:
            self.clear()

        super().__setitem__(key, value)


def convert_to_datetime_aware(date_obj):
    if date_obj.tzinfo is None:
        date_obj = date_obj.replace(tzinfo=timezone.utc)
    return date_obj


def str_icontains(source, search):
    """
    Check if a string contains another string, ignoring case.

    Args:
        source: The string to search within
        search: The substring to search for

    Returns:
        bool: True if search is a substring of source (case-insensitive), False otherwise

    Examples:
        >>> str_icontains("Hello World", "WORLD")
        True
        >>> str_icontains("Hello World", "python")
        False
    """
    return str(search).casefold() in str(source).casefold()


def str_iequals(value, comparand):
    """
    Check if a string equals another string, ignoring case.

    Args:
        value: The string to compare
        comparand: The string to compare with

    Returns:
        bool: True if value and comparand are equal (case-insensitive), False otherwise

    Examples:
        >>> str_iequals("Hello World", "hello world")
        True
        >>> str_iequals("Hello World", "hello")
        False
    """
    return str(value).casefold() == str(comparand).casefold()
