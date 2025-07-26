# Copyright (C) 2016-present the asyncpg authors and contributors
# <see AUTHORS file>
#
# This module is part of asyncpg and is released under
# the Apache 2.0 License: http://www.apache.org/licenses/LICENSE-2.0


import re

from .types import ServerVersion

version_regex = re.compile(
    r"(Postgre[^\s]*)?\s*"
    r"(?P<major>[0-9]+)\.?"
    r"((?P<minor>[0-9]+)\.?)?"
    r"(?P<micro>[0-9]+)?"
    r"(?P<releaselevel>[a-z]+)?"
    r"(?P<serial>[0-9]+)?"
)


def split_server_version_string(version_string):
    version_match = version_regex.search(version_string)

    if version_match is None:
        raise ValueError(
            "Unable to parse Postgres "
            f'version from "{version_string}"'
        )

    version = version_match.groupdict()
    for ver_key, ver_value in version.items():
        # Cast all possible versions parts to int
        try:
            version[ver_key] = int(ver_value)
        except (TypeError, ValueError):
            pass

    if version.get("major") < 10:
        return ServerVersion(
            version.get("major"),
            version.get("minor") or 0,
            version.get("micro") or 0,
            version.get("releaselevel") or "final",
            version.get("serial") or 0,
        )

    # Since PostgreSQL 10 the versioning scheme has changed.
    # 10.x really means 10.0.x.  While parsing 10.1
    # as (10, 1) may seem less confusing, in practice most
    # version checks are written as version[:2], and we
    # want to keep that behaviour consistent, i.e not fail
    # a major version check due to a bugfix release.
    return ServerVersion(
        version.get("major"),
        0,
        version.get("minor") or 0,
        version.get("releaselevel") or "final",
        version.get("serial") or 0,
    )
