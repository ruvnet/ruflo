"""Implementation of the JSON adaptation objects

This module exists to avoid a circular import problem: pyscopg2.extras depends
on psycopg2.extension, so I can't create the default JSON typecasters in
extensions importing register_json from extras.
"""

# psycopg/_json.py - Implementation of the JSON adaptation objects
#
# Copyright (C) 2012-2019 Daniele Varrazzo  <daniele.varrazzo@gmail.com>
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

import json

from psycopg2._psycopg import ISQLQuote, QuotedString
from psycopg2._psycopg import new_type, new_array_type, register_type


# oids from PostgreSQL 9.2
JSON_OID = 114
JSONARRAY_OID = 199

# oids from PostgreSQL 9.4
JSONB_OID = 3802
JSONBARRAY_OID = 3807


class Json:
    """
    An `~psycopg2.extensions.ISQLQuote` wrapper to adapt a Python object to
    :sql:`json` data type.

    `!Json` can be used to wrap any object supported by the provided *dumps*
    function. If none is provided, the standard :py:func:`json.dumps()` is
    used.

    """
    def __init__(self, adapted, dumps=None):
        self.adapted = adapted
        self._conn = None
        self._dumps = dumps or json.dumps

    def __conform__(self, proto):
        if proto is ISQLQuote:
            return self

    def dumps(self, obj):
        """Serialize *obj* in JSON format.

        The default is to call `!json.dumps()` or the *dumps* function
        provided in the constructor. You can override this method to create a
        customized JSON wrapper.
        """
        return self._dumps(obj)

    def prepare(self, conn):
        self._conn = conn

    def getquoted(self):
        s = self.dumps(self.adapted)
        qs = QuotedString(s)
        if self._conn is not None:
            qs.prepare(self._conn)
        return qs.getquoted()

    def __str__(self):
        # getquoted is binary
        return self.getquoted().decode('ascii', 'replace')


def register_json(conn_or_curs=None, globally=False, loads=None,
                  oid=None, array_oid=None, name='json'):
    """Create and register typecasters converting :sql:`json` type to Python objects.

    :param conn_or_curs: a connection or cursor used to find the :sql:`json`
        and :sql:`json[]` oids; the typecasters are registered in a scope
        limited to this object, unless *globally* is set to `!True`. It can be
        `!None` if the oids are provided
    :param globally: if `!False` register the typecasters only on
        *conn_or_curs*, otherwise register them globally
    :param loads: the function used to parse the data into a Python object. If
        `!None` use `!json.loads()`, where `!json` is the module chosen
        according to the Python version (see above)
    :param oid: the OID of the :sql:`json` type if known; If not, it will be
        queried on *conn_or_curs*
    :param array_oid: the OID of the :sql:`json[]` array type if known;
        if not, it will be queried on *conn_or_curs*
    :param name: the name of the data type to look for in *conn_or_curs*

    The connection or cursor passed to the function will be used to query the
    database and look for the OID of the :sql:`json` type (or an alternative
    type if *name* if provided). No query is performed if *oid* and *array_oid*
    are provided.  Raise `~psycopg2.ProgrammingError` if the type is not found.

    """
    if oid is None:
        oid, array_oid = _get_json_oids(conn_or_curs, name)

    JSON, JSONARRAY = _create_json_typecasters(
        oid, array_oid, loads=loads, name=name.upper())

    register_type(JSON, not globally and conn_or_curs or None)

    if JSONARRAY is not None:
        register_type(JSONARRAY, not globally and conn_or_curs or None)

    return JSON, JSONARRAY


def register_default_json(conn_or_curs=None, globally=False, loads=None):
    """
    Create and register :sql:`json` typecasters for PostgreSQL 9.2 and following.

    Since PostgreSQL 9.2 :sql:`json` is a builtin type, hence its oid is known
    and fixed. This function allows specifying a customized *loads* function
    for the default :sql:`json` type without querying the database.
    All the parameters have the same meaning of `register_json()`.
    """
    return register_json(conn_or_curs=conn_or_curs, globally=globally,
        loads=loads, oid=JSON_OID, array_oid=JSONARRAY_OID)


def register_default_jsonb(conn_or_curs=None, globally=False, loads=None):
    """
    Create and register :sql:`jsonb` typecasters for PostgreSQL 9.4 and following.

    As in `register_default_json()`, the function allows to register a
    customized *loads* function for the :sql:`jsonb` type at its known oid for
    PostgreSQL 9.4 and following versions.  All the parameters have the same
    meaning of `register_json()`.
    """
    return register_json(conn_or_curs=conn_or_curs, globally=globally,
        loads=loads, oid=JSONB_OID, array_oid=JSONBARRAY_OID, name='jsonb')


def _create_json_typecasters(oid, array_oid, loads=None, name='JSON'):
    """Create typecasters for json data type."""
    if loads is None:
        loads = json.loads

    def typecast_json(s, cur):
        if s is None:
            return None
        return loads(s)

    JSON = new_type((oid, ), name, typecast_json)
    if array_oid is not None:
        JSONARRAY = new_array_type((array_oid, ), f"{name}ARRAY", JSON)
    else:
        JSONARRAY = None

    return JSON, JSONARRAY


def _get_json_oids(conn_or_curs, name='json'):
    # lazy imports
    from psycopg2.extensions import STATUS_IN_TRANSACTION
    from psycopg2.extras import _solve_conn_curs

    conn, curs = _solve_conn_curs(conn_or_curs)

    # Store the transaction status of the connection to revert it after use
    conn_status = conn.status

    # column typarray not available before PG 8.3
    typarray = conn.info.server_version >= 80300 and "typarray" or "NULL"

    # get the oid for the hstore
    curs.execute(
        "SELECT t.oid, %s FROM pg_type t WHERE t.typname = %%s;"
        % typarray, (name,))
    r = curs.fetchone()

    # revert the status of the connection as before the command
    if conn_status != STATUS_IN_TRANSACTION and not conn.autocommit:
        conn.rollback()

    if not r:
        raise conn.ProgrammingError(f"{name} data type not found")

    return r
