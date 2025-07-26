# dialects/mssql/provision.py
# Copyright (C) 2005-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php
# mypy: ignore-errors

from sqlalchemy import inspect
from sqlalchemy import Integer
from ... import create_engine
from ... import exc
from ...schema import Column
from ...schema import DropConstraint
from ...schema import ForeignKeyConstraint
from ...schema import MetaData
from ...schema import Table
from ...testing.provision import create_db
from ...testing.provision import drop_all_schema_objects_pre_tables
from ...testing.provision import drop_db
from ...testing.provision import generate_driver_url
from ...testing.provision import get_temp_table_name
from ...testing.provision import log
from ...testing.provision import normalize_sequence
from ...testing.provision import run_reap_dbs
from ...testing.provision import temp_table_keyword_args


@generate_driver_url.for_db("mssql")
def generate_driver_url(url, driver, query_str):
    backend = url.get_backend_name()

    new_url = url.set(drivername="%s+%s" % (backend, driver))

    if driver not in ("pyodbc", "aioodbc"):
        new_url = new_url.set(query="")

    if driver == "aioodbc":
        new_url = new_url.update_query_dict({"MARS_Connection": "Yes"})

    if query_str:
        new_url = new_url.update_query_string(query_str)

    try:
        new_url.get_dialect()
    except exc.NoSuchModuleError:
        return None
    else:
        return new_url


@create_db.for_db("mssql")
def _mssql_create_db(cfg, eng, ident):
    with eng.connect().execution_options(isolation_level="AUTOCOMMIT") as conn:
        conn.exec_driver_sql("create database %s" % ident)
        conn.exec_driver_sql(
            "ALTER DATABASE %s SET ALLOW_SNAPSHOT_ISOLATION ON" % ident
        )
        conn.exec_driver_sql(
            "ALTER DATABASE %s SET READ_COMMITTED_SNAPSHOT ON" % ident
        )
        conn.exec_driver_sql("use %s" % ident)
        conn.exec_driver_sql("create schema test_schema")
        conn.exec_driver_sql("create schema test_schema_2")


@drop_db.for_db("mssql")
def _mssql_drop_db(cfg, eng, ident):
    with eng.connect().execution_options(isolation_level="AUTOCOMMIT") as conn:
        _mssql_drop_ignore(conn, ident)


def _mssql_drop_ignore(conn, ident):
    try:
        # typically when this happens, we can't KILL the session anyway,
        # so let the cleanup process drop the DBs
        # for row in conn.exec_driver_sql(
        #     "select session_id from sys.dm_exec_sessions "
        #        "where database_id=db_id('%s')" % ident):
        #    log.info("killing SQL server session %s", row['session_id'])
        #    conn.exec_driver_sql("kill %s" % row['session_id'])
        conn.exec_driver_sql("drop database %s" % ident)
        log.info("Reaped db: %s", ident)
        return True
    except exc.DatabaseError as err:
        log.warning("couldn't drop db: %s", err)
        return False


@run_reap_dbs.for_db("mssql")
def _reap_mssql_dbs(url, idents):
    log.info("db reaper connecting to %r", url)
    eng = create_engine(url)
    with eng.connect().execution_options(isolation_level="AUTOCOMMIT") as conn:
        log.info("identifiers in file: %s", ", ".join(idents))

        to_reap = conn.exec_driver_sql(
            "select d.name from sys.databases as d where name "
            "like 'TEST_%' and not exists (select session_id "
            "from sys.dm_exec_sessions "
            "where database_id=d.database_id)"
        )
        all_names = {dbname.lower() for (dbname,) in to_reap}
        to_drop = set()
        for name in all_names:
            if name in idents:
                to_drop.add(name)

        dropped = total = 0
        for total, dbname in enumerate(to_drop, 1):
            if _mssql_drop_ignore(conn, dbname):
                dropped += 1
        log.info(
            "Dropped %d out of %d stale databases detected", dropped, total
        )


@temp_table_keyword_args.for_db("mssql")
def _mssql_temp_table_keyword_args(cfg, eng):
    return {}


@get_temp_table_name.for_db("mssql")
def _mssql_get_temp_table_name(cfg, eng, base_name):
    return "##" + base_name


@drop_all_schema_objects_pre_tables.for_db("mssql")
def drop_all_schema_objects_pre_tables(cfg, eng):
    with eng.connect().execution_options(isolation_level="AUTOCOMMIT") as conn:
        inspector = inspect(conn)
        for schema in (None, "dbo", cfg.test_schema, cfg.test_schema_2):
            for tname in inspector.get_table_names(schema=schema):
                tb = Table(
                    tname,
                    MetaData(),
                    Column("x", Integer),
                    Column("y", Integer),
                    schema=schema,
                )
                for fk in inspect(conn).get_foreign_keys(tname, schema=schema):
                    conn.execute(
                        DropConstraint(
                            ForeignKeyConstraint(
                                [tb.c.x], [tb.c.y], name=fk["name"]
                            )
                        )
                    )


@normalize_sequence.for_db("mssql")
def normalize_sequence(cfg, sequence):
    if sequence.start is None:
        sequence.start = 1
    return sequence
