# Copyright (C) Dnspython Contributors, see LICENSE for text of ISC license

import importlib.metadata
import itertools
import string
from typing import Dict, List, Tuple


def _tuple_from_text(version: str) -> Tuple:
    text_parts = version.split(".")
    int_parts = []
    for text_part in text_parts:
        digit_prefix = "".join(
            itertools.takewhile(lambda x: x in string.digits, text_part)
        )
        try:
            int_parts.append(int(digit_prefix))
        except Exception:
            break
    return tuple(int_parts)


def _version_check(
    requirement: str,
) -> bool:
    """Is the requirement fulfilled?

    The requirement must be of the form

        package>=version
    """
    package, minimum = requirement.split(">=")
    try:
        version = importlib.metadata.version(package)
        # This shouldn't happen, but it apparently can.
        if version is None:
            return False
    except Exception:
        return False
    t_version = _tuple_from_text(version)
    t_minimum = _tuple_from_text(minimum)
    if t_version < t_minimum:
        return False
    return True


_cache: Dict[str, bool] = {}


def have(feature: str) -> bool:
    """Is *feature* available?

    This tests if all optional packages needed for the
    feature are available and recent enough.

    Returns ``True`` if the feature is available,
    and ``False`` if it is not or if metadata is
    missing.
    """
    value = _cache.get(feature)
    if value is not None:
        return value
    requirements = _requirements.get(feature)
    if requirements is None:
        # we make a cache entry here for consistency not performance
        _cache[feature] = False
        return False
    ok = True
    for requirement in requirements:
        if not _version_check(requirement):
            ok = False
            break
    _cache[feature] = ok
    return ok


def force(feature: str, enabled: bool) -> None:
    """Force the status of *feature* to be *enabled*.

    This method is provided as a workaround for any cases
    where importlib.metadata is ineffective, or for testing.
    """
    _cache[feature] = enabled


_requirements: Dict[str, List[str]] = {
    ### BEGIN generated requirements
    "dnssec": ["cryptography>=43"],
    "doh": ["httpcore>=1.0.0", "httpx>=0.26.0", "h2>=4.1.0"],
    "doq": ["aioquic>=1.0.0"],
    "idna": ["idna>=3.7"],
    "trio": ["trio>=0.23"],
    "wmi": ["wmi>=1.5.1"],
    ### END generated requirements
}
