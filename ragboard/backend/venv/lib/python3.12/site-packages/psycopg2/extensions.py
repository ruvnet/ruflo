"""psycopg extensions to the DBAPI-2.0

This module holds all the extensions to the DBAPI-2.0 provided by psycopg.

- `connection` -- the new-type inheritable connection class
- `cursor` -- the new-type inheritable cursor class
- `lobject` -- the new-type inheritable large object class
- `adapt()` -- exposes the PEP-246_ compatible adapting mechanism used
  by psycopg to adapt Python types to PostgreSQL ones

.. _PEP-246: https://www.python.org/dev/peps/pep-0246/
"""
# psycopg/extensions.py - DBAPI-2.0 extensions specific to psycopg
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

import re as _re

from psycopg2._psycopg import (                             # noqa
    BINARYARRAY, BOOLEAN, BOOLEANARRAY, BYTES, BYTESARRAY, DATE, DATEARRAY,
    DATETIMEARRAY, DECIMAL, DECIMALARRAY, FLOAT, FLOATARRAY, INTEGER,
    INTEGERARRAY, INTERVAL, INTERVALARRAY, LONGINTEGER, LONGINTEGERARRAY,
    ROWIDARRAY, STRINGARRAY, TIME, TIMEARRAY, UNICODE, UNICODEARRAY,
    AsIs, Binary, Boolean, Float, Int, QuotedString, )

from psycopg2._psycopg import (                         # noqa
    PYDATE, PYDATETIME, PYDATETIMETZ, PYINTERVAL, PYTIME, PYDATEARRAY,
    PYDATETIMEARRAY, PYDATETIMETZARRAY, PYINTERVALARRAY, PYTIMEARRAY,
    DateFromPy, TimeFromPy, TimestampFromPy, IntervalFromPy, )

from psycopg2._psycopg import (                             # noqa
    adapt, adapters, encodings, connection, cursor,
    lobject, Xid, libpq_version, parse_dsn, quote_ident,
    string_types, binary_types, new_type, new_array_type, register_type,
    ISQLQuote, Notify, Diagnostics, Column, ConnectionInfo,
    QueryCanceledError, TransactionRollbackError,
    set_wait_callback, get_wait_callback, encrypt_password, )


"""Isolation level values."""
ISOLATION_LEVEL_AUTOCOMMIT = 0
ISOLATION_LEVEL_READ_UNCOMMITTED = 4
ISOLATION_LEVEL_READ_COMMITTED = 1
ISOLATION_LEVEL_REPEATABLE_READ = 2
ISOLATION_LEVEL_SERIALIZABLE = 3
ISOLATION_LEVEL_DEFAULT = None


"""psycopg connection status values."""
STATUS_SETUP = 0
STATUS_READY = 1
STATUS_BEGIN = 2
STATUS_SYNC = 3  # currently unused
STATUS_ASYNC = 4  # currently unused
STATUS_PREPARED = 5

# This is a useful mnemonic to check if the connection is in a transaction
STATUS_IN_TRANSACTION = STATUS_BEGIN


"""psycopg asynchronous connection polling values"""
POLL_OK = 0
POLL_READ = 1
POLL_WRITE = 2
POLL_ERROR = 3


"""Backend transaction status values."""
TRANSACTION_STATUS_IDLE = 0
TRANSACTION_STATUS_ACTIVE = 1
TRANSACTION_STATUS_INTRANS = 2
TRANSACTION_STATUS_INERROR = 3
TRANSACTION_STATUS_UNKNOWN = 4


def register_adapter(typ, callable):
    """Register 'callable' as an ISQLQuote adapter for type 'typ'."""
    adapters[(typ, ISQLQuote)] = callable


# The SQL_IN class is the official adapter for tuples starting from 2.0.6.
class SQL_IN:
    """Adapt any iterable to an SQL quotable object."""
    def __init__(self, seq):
        self._seq = seq
        self._conn = None

    def prepare(self, conn):
        self._conn = conn

    def getquoted(self):
        # this is the important line: note how every object in the
        # list is adapted and then how getquoted() is called on it
        pobjs = [adapt(o) for o in self._seq]
        if self._conn is not None:
            for obj in pobjs:
                if hasattr(obj, 'prepare'):
                    obj.prepare(self._conn)
        qobjs = [o.getquoted() for o in pobjs]
        return b'(' + b', '.join(qobjs) + b')'

    def __str__(self):
        return str(self.getquoted())


class NoneAdapter:
    """Adapt None to NULL.

    This adapter is not used normally as a fast path in mogrify uses NULL,
    but it makes easier to adapt composite types.
    """
    def __init__(self, obj):
        pass

    def getquoted(self, _null=b"NULL"):
        return _null


def make_dsn(dsn=None, **kwargs):
    """Convert a set of keywords into a connection strings."""
    if dsn is None and not kwargs:
        return ''

    # If no kwarg is specified don't mung the dsn, but verify it
    if not kwargs:
        parse_dsn(dsn)
        return dsn

    # Override the dsn with the parameters
    if 'database' in kwargs:
        if 'dbname' in kwargs:
            raise TypeError(
                "you can't specify both 'database' and 'dbname' arguments")
        kwargs['dbname'] = kwargs.pop('database')

    # Drop the None arguments
    kwargs = {k: v for (k, v) in kwargs.items() if v is not None}

    if dsn is not None:
        tmp = parse_dsn(dsn)
        tmp.update(kwargs)
        kwargs = tmp

    dsn = " ".join(["{}={}".format(k, _param_escape(str(v)))
        for (k, v) in kwargs.items()])

    # verify that the returned dsn is valid
    parse_dsn(dsn)

    return dsn


def _param_escape(s,
        re_escape=_re.compile(r"([\\'])"),
        re_space=_re.compile(r'\s')):
    """
    Apply the escaping rule required by PQconnectdb
    """
    if not s:
        return "''"

    s = re_escape.sub(r'\\\1', s)
    if re_space.search(s):
        s = "'" + s + "'"

    return s


# Create default json typecasters for PostgreSQL 9.2 oids
from psycopg2._json import register_default_json, register_default_jsonb    # noqa

try:
    JSON, JSONARRAY = register_default_json()
    JSONB, JSONBARRAY = register_default_jsonb()
except ImportError:
    pass

del register_default_json, register_default_jsonb


# Create default Range typecasters
from psycopg2. _range import Range                              # noqa
del Range


# Add the "cleaned" version of the encodings to the key.
# When the encoding is set its name is cleaned up from - and _ and turned
# uppercase, so an encoding not respecting these rules wouldn't be found in the
# encodings keys and would raise an exception with the unicode typecaster
for k, v in list(encodings.items()):
    k = k.replace('_', '').replace('-', '').upper()
    encodings[k] = v

del k, v
