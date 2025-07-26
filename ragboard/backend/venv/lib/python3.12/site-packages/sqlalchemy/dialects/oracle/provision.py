# dialects/oracle/provision.py
# Copyright (C) 2005-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php
# mypy: ignore-errors

from ... import create_engine
from ... import exc
from ... import inspect
from ...engine import url as sa_url
from ...testing.provision import configure_follower
from ...testing.provision import create_db
from ...testing.provision import drop_all_schema_objects_post_tables
from ...testing.provision import drop_all_schema_objects_pre_tables
from ...testing.provision import drop_db
from ...testing.provision import follower_url_from_main
from ...testing.provision import log
from ...testing.provision import post_configure_engine
from ...testing.provision import run_reap_dbs
from ...testing.provision import set_default_schema_on_connection
from ...testing.provision import stop_test_class_outside_fixtures
from ...testing.provision import temp_table_keyword_args
from ...testing.provision import update_db_opts


@create_db.for_db("oracle")
def _oracle_create_db(cfg, eng, ident):
    # NOTE: make sure you've run "ALTER DATABASE default tablespace users" or
    # similar, so that the default tablespace is not "system"; reflection will
    # fail otherwise
    with eng.begin() as conn:
        conn.exec_driver_sql("create user %s identified by xe" % ident)
        conn.exec_driver_sql("create user %s_ts1 identified by xe" % ident)
        conn.exec_driver_sql("create user %s_ts2 identified by xe" % ident)
        conn.exec_driver_sql("grant dba to %s" % (ident,))
        conn.exec_driver_sql("grant unlimited tablespace to %s" % ident)
        conn.exec_driver_sql("grant unlimited tablespace to %s_ts1" % ident)
        conn.exec_driver_sql("grant unlimited tablespace to %s_ts2" % ident)
        # these are needed to create materialized views
        conn.exec_driver_sql("grant create table to %s" % ident)
        conn.exec_driver_sql("grant create table to %s_ts1" % ident)
        conn.exec_driver_sql("grant create table to %s_ts2" % ident)


@configure_follower.for_db("oracle")
def _oracle_configure_follower(config, ident):
    config.test_schema = "%s_ts1" % ident
    config.test_schema_2 = "%s_ts2" % ident


def _ora_drop_ignore(conn, dbname):
    try:
        conn.exec_driver_sql("drop user %s cascade" % dbname)
        log.info("Reaped db: %s", dbname)
        return True
    except exc.DatabaseError as err:
        log.warning("couldn't drop db: %s", err)
        return False


@drop_all_schema_objects_pre_tables.for_db("oracle")
def _ora_drop_all_schema_objects_pre_tables(cfg, eng):
    _purge_recyclebin(eng)
    _purge_recyclebin(eng, cfg.test_schema)


@drop_all_schema_objects_post_tables.for_db("oracle")
def _ora_drop_all_schema_objects_post_tables(cfg, eng):
    with eng.begin() as conn:
        for syn in conn.dialect._get_synonyms(conn, None, None, None):
            conn.exec_driver_sql(f"drop synonym {syn['synonym_name']}")

        for syn in conn.dialect._get_synonyms(
            conn, cfg.test_schema, None, None
        ):
            conn.exec_driver_sql(
                f"drop synonym {cfg.test_schema}.{syn['synonym_name']}"
            )

        for tmp_table in inspect(conn).get_temp_table_names():
            conn.exec_driver_sql(f"drop table {tmp_table}")


@drop_db.for_db("oracle")
def _oracle_drop_db(cfg, eng, ident):
    with eng.begin() as conn:
        # cx_Oracle seems to occasionally leak open connections when a large
        # suite it run, even if we confirm we have zero references to
        # connection objects.
        # while there is a "kill session" command in Oracle,
        # it unfortunately does not release the connection sufficiently.
        _ora_drop_ignore(conn, ident)
        _ora_drop_ignore(conn, "%s_ts1" % ident)
        _ora_drop_ignore(conn, "%s_ts2" % ident)


@stop_test_class_outside_fixtures.for_db("oracle")
def _ora_stop_test_class_outside_fixtures(config, db, cls):
    try:
        _purge_recyclebin(db)
    except exc.DatabaseError as err:
        log.warning("purge recyclebin command failed: %s", err)

    # clear statement cache on all connections that were used
    # https://github.com/oracle/python-cx_Oracle/issues/519

    for cx_oracle_conn in _all_conns:
        try:
            sc = cx_oracle_conn.stmtcachesize
        except db.dialect.dbapi.InterfaceError:
            # connection closed
            pass
        else:
            cx_oracle_conn.stmtcachesize = 0
            cx_oracle_conn.stmtcachesize = sc
    _all_conns.clear()


def _purge_recyclebin(eng, schema=None):
    with eng.begin() as conn:
        if schema is None:
            # run magic command to get rid of identity sequences
            # https://floo.bar/2019/11/29/drop-the-underlying-sequence-of-an-identity-column/  # noqa: E501
            conn.exec_driver_sql("purge recyclebin")
        else:
            # per user: https://community.oracle.com/tech/developers/discussion/2255402/how-to-clear-dba-recyclebin-for-a-particular-user  # noqa: E501
            for owner, object_name, type_ in conn.exec_driver_sql(
                "select owner, object_name,type from "
                "dba_recyclebin where owner=:schema and type='TABLE'",
                {"schema": conn.dialect.denormalize_name(schema)},
            ).all():
                conn.exec_driver_sql(f'purge {type_} {owner}."{object_name}"')


_all_conns = set()


@post_configure_engine.for_db("oracle")
def _oracle_post_configure_engine(url, engine, follower_ident):
    from sqlalchemy import event

    @event.listens_for(engine, "checkout")
    def checkout(dbapi_con, con_record, con_proxy):
        _all_conns.add(dbapi_con)

    @event.listens_for(engine, "checkin")
    def checkin(dbapi_connection, connection_record):
        # work around cx_Oracle issue:
        # https://github.com/oracle/python-cx_Oracle/issues/530
        # invalidate oracle connections that had 2pc set up
        if "cx_oracle_xid" in connection_record.info:
            connection_record.invalidate()


@run_reap_dbs.for_db("oracle")
def _reap_oracle_dbs(url, idents):
    log.info("db reaper connecting to %r", url)
    eng = create_engine(url)
    with eng.begin() as conn:
        log.info("identifiers in file: %s", ", ".join(idents))

        to_reap = conn.exec_driver_sql(
            "select u.username from all_users u where username "
            "like 'TEST_%' and not exists (select username "
            "from v$session where username=u.username)"
        )
        all_names = {username.lower() for (username,) in to_reap}
        to_drop = set()
        for name in all_names:
            if name.endswith("_ts1") or name.endswith("_ts2"):
                continue
            elif name in idents:
                to_drop.add(name)
                if "%s_ts1" % name in all_names:
                    to_drop.add("%s_ts1" % name)
                if "%s_ts2" % name in all_names:
                    to_drop.add("%s_ts2" % name)

        dropped = total = 0
        for total, username in enumerate(to_drop, 1):
            if _ora_drop_ignore(conn, username):
                dropped += 1
        log.info(
            "Dropped %d out of %d stale databases detected", dropped, total
        )


@follower_url_from_main.for_db("oracle")
def _oracle_follower_url_from_main(url, ident):
    url = sa_url.make_url(url)
    return url.set(username=ident, password="xe")


@temp_table_keyword_args.for_db("oracle")
def _oracle_temp_table_keyword_args(cfg, eng):
    return {
        "prefixes": ["GLOBAL TEMPORARY"],
        "oracle_on_commit": "PRESERVE ROWS",
    }


@set_default_schema_on_connection.for_db("oracle")
def _oracle_set_default_schema_on_connection(
    cfg, dbapi_connection, schema_name
):
    cursor = dbapi_connection.cursor()
    cursor.execute("ALTER SESSION SET CURRENT_SCHEMA=%s" % schema_name)
    cursor.close()


@update_db_opts.for_db("oracle")
def _update_db_opts(db_url, db_opts, options):
    """Set database options (db_opts) for a test database that we created."""
    if (
        options.oracledb_thick_mode
        and sa_url.make_url(db_url).get_driver_name() == "oracledb"
    ):
        db_opts["thick_mode"] = True
