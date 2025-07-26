"""Error classes for PostgreSQL error codes
"""

# psycopg/errors.py - SQLSTATE and DB-API exceptions
#
# Copyright (C) 2018-2019 Daniele Varrazzo  <daniele.varrazzo@gmail.com>
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

#
# NOTE: the exceptions are injected into this module by the C extention.
#


def lookup(code):
    """Lookup an error code and return its exception class.

    Raise `!KeyError` if the code is not found.
    """
    from psycopg2._psycopg import sqlstate_errors   # avoid circular import
    return sqlstate_errors[code]
