# dialects/postgresql/provision.py
# Copyright (C) 2005-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php
# mypy: ignore-errors

import time

from ... import exc
from ... import inspect
from ... import text
from ...testing import warn_test_suite
from ...testing.provision import create_db
from ...testing.provision import drop_all_schema_objects_post_tables
from ...testing.provision import drop_all_schema_objects_pre_tables
from ...testing.provision import drop_db
from ...testing.provision import log
from ...testing.provision import post_configure_engine
from ...testing.provision import prepare_for_drop_tables
from ...testing.provision import set_default_schema_on_connection
from ...testing.provision import temp_table_keyword_args
from ...testing.provision import upsert


@create_db.for_db("postgresql")
def _pg_create_db(cfg, eng, ident):
    template_db = cfg.options.postgresql_templatedb

    with eng.execution_options(isolation_level="AUTOCOMMIT").begin() as conn:
        if not template_db:
            template_db = conn.exec_driver_sql(
                "select current_database()"
            ).scalar()

        attempt = 0
        while True:
            try:
                conn.exec_driver_sql(
                    "CREATE DATABASE %s TEMPLATE %s" % (ident, template_db)
                )
            except exc.OperationalError as err:
                attempt += 1
                if attempt >= 3:
                    raise
                if "accessed by other users" in str(err):
                    log.info(
                        "Waiting to create %s, URI %r, "
                        "template DB %s is in use sleeping for .5",
                        ident,
                        eng.url,
                        template_db,
                    )
                    time.sleep(0.5)
            except:
                raise
            else:
                break


@drop_db.for_db("postgresql")
def _pg_drop_db(cfg, eng, ident):
    with eng.connect().execution_options(isolation_level="AUTOCOMMIT") as conn:
        with conn.begin():
            conn.execute(
                text(
                    "select pg_terminate_backend(pid) from pg_stat_activity "
                    "where usename=current_user and pid != pg_backend_pid() "
                    "and datname=:dname"
                ),
                dict(dname=ident),
            )
            conn.exec_driver_sql("DROP DATABASE %s" % ident)


@temp_table_keyword_args.for_db("postgresql")
def _postgresql_temp_table_keyword_args(cfg, eng):
    return {"prefixes": ["TEMPORARY"]}


@set_default_schema_on_connection.for_db("postgresql")
def _postgresql_set_default_schema_on_connection(
    cfg, dbapi_connection, schema_name
):
    existing_autocommit = dbapi_connection.autocommit
    dbapi_connection.autocommit = True
    cursor = dbapi_connection.cursor()
    cursor.execute("SET SESSION search_path='%s'" % schema_name)
    cursor.close()
    dbapi_connection.autocommit = existing_autocommit


@drop_all_schema_objects_pre_tables.for_db("postgresql")
def drop_all_schema_objects_pre_tables(cfg, eng):
    with eng.connect().execution_options(isolation_level="AUTOCOMMIT") as conn:
        for xid in conn.exec_driver_sql(
            "select gid from pg_prepared_xacts"
        ).scalars():
            conn.execute("ROLLBACK PREPARED '%s'" % xid)


@drop_all_schema_objects_post_tables.for_db("postgresql")
def drop_all_schema_objects_post_tables(cfg, eng):
    from sqlalchemy.dialects import postgresql

    inspector = inspect(eng)
    with eng.begin() as conn:
        for enum in inspector.get_enums("*"):
            conn.execute(
                postgresql.DropEnumType(
                    postgresql.ENUM(name=enum["name"], schema=enum["schema"])
                )
            )


@prepare_for_drop_tables.for_db("postgresql")
def prepare_for_drop_tables(config, connection):
    """Ensure there are no locks on the current username/database."""

    result = connection.exec_driver_sql(
        "select pid, state, wait_event_type, query "
        # "select pg_terminate_backend(pid), state, wait_event_type "
        "from pg_stat_activity where "
        "usename=current_user "
        "and datname=current_database() and state='idle in transaction' "
        "and pid != pg_backend_pid()"
    )
    rows = result.all()  # noqa
    if rows:
        warn_test_suite(
            "PostgreSQL may not be able to DROP tables due to "
            "idle in transaction: %s"
            % ("; ".join(row._mapping["query"] for row in rows))
        )


@upsert.for_db("postgresql")
def _upsert(
    cfg, table, returning, *, set_lambda=None, sort_by_parameter_order=False
):
    from sqlalchemy.dialects.postgresql import insert

    stmt = insert(table)

    table_pk = inspect(table).selectable

    if set_lambda:
        stmt = stmt.on_conflict_do_update(
            index_elements=table_pk.primary_key, set_=set_lambda(stmt.excluded)
        )
    else:
        stmt = stmt.on_conflict_do_nothing()

    stmt = stmt.returning(
        *returning, sort_by_parameter_order=sort_by_parameter_order
    )
    return stmt


_extensions = [
    ("citext", (13,)),
    ("hstore", (13,)),
]


@post_configure_engine.for_db("postgresql")
def _create_citext_extension(url, engine, follower_ident):
    with engine.connect() as conn:
        for extension, min_version in _extensions:
            if conn.dialect.server_version_info >= min_version:
                conn.execute(
                    text(f"CREATE EXTENSION IF NOT EXISTS {extension}")
                )
                conn.commit()
