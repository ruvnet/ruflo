# dialects/mysql/provision.py
# Copyright (C) 2005-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php
# mypy: ignore-errors

from ... import exc
from ...testing.provision import configure_follower
from ...testing.provision import create_db
from ...testing.provision import drop_db
from ...testing.provision import generate_driver_url
from ...testing.provision import temp_table_keyword_args
from ...testing.provision import upsert


@generate_driver_url.for_db("mysql", "mariadb")
def generate_driver_url(url, driver, query_str):
    backend = url.get_backend_name()

    # NOTE: at the moment, tests are running mariadbconnector
    # against both mariadb and mysql backends.   if we want this to be
    # limited, do the decision making here to reject a "mysql+mariadbconnector"
    # URL.  Optionally also re-enable the module level
    # MySQLDialect_mariadbconnector.is_mysql flag as well, which must include
    # a unit and/or functional test.

    # all the Jenkins tests have been running mysqlclient Python library
    # built against mariadb client drivers for years against all MySQL /
    # MariaDB versions going back to MySQL 5.6, currently they can talk
    # to MySQL databases without problems.

    if backend == "mysql":
        dialect_cls = url.get_dialect()
        if dialect_cls._is_mariadb_from_url(url):
            backend = "mariadb"

    new_url = url.set(
        drivername="%s+%s" % (backend, driver)
    ).update_query_string(query_str)

    try:
        new_url.get_dialect()
    except exc.NoSuchModuleError:
        return None
    else:
        return new_url


@create_db.for_db("mysql", "mariadb")
def _mysql_create_db(cfg, eng, ident):
    with eng.begin() as conn:
        try:
            _mysql_drop_db(cfg, conn, ident)
        except Exception:
            pass

    with eng.begin() as conn:
        conn.exec_driver_sql(
            "CREATE DATABASE %s CHARACTER SET utf8mb4" % ident
        )
        conn.exec_driver_sql(
            "CREATE DATABASE %s_test_schema CHARACTER SET utf8mb4" % ident
        )
        conn.exec_driver_sql(
            "CREATE DATABASE %s_test_schema_2 CHARACTER SET utf8mb4" % ident
        )


@configure_follower.for_db("mysql", "mariadb")
def _mysql_configure_follower(config, ident):
    config.test_schema = "%s_test_schema" % ident
    config.test_schema_2 = "%s_test_schema_2" % ident


@drop_db.for_db("mysql", "mariadb")
def _mysql_drop_db(cfg, eng, ident):
    with eng.begin() as conn:
        conn.exec_driver_sql("DROP DATABASE %s_test_schema" % ident)
        conn.exec_driver_sql("DROP DATABASE %s_test_schema_2" % ident)
        conn.exec_driver_sql("DROP DATABASE %s" % ident)


@temp_table_keyword_args.for_db("mysql", "mariadb")
def _mysql_temp_table_keyword_args(cfg, eng):
    return {"prefixes": ["TEMPORARY"]}


@upsert.for_db("mariadb")
def _upsert(
    cfg, table, returning, *, set_lambda=None, sort_by_parameter_order=False
):
    from sqlalchemy.dialects.mysql import insert

    stmt = insert(table)

    if set_lambda:
        stmt = stmt.on_duplicate_key_update(**set_lambda(stmt.inserted))
    else:
        pk1 = table.primary_key.c[0]
        stmt = stmt.on_duplicate_key_update({pk1.key: pk1})

    stmt = stmt.returning(
        *returning, sort_by_parameter_order=sort_by_parameter_order
    )
    return stmt
