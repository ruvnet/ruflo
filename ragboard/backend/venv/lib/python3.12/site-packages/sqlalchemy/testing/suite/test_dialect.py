# testing/suite/test_dialect.py
# Copyright (C) 2005-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php
# mypy: ignore-errors


import importlib

from . import testing
from .. import assert_raises
from .. import config
from .. import engines
from .. import eq_
from .. import fixtures
from .. import is_not_none
from .. import is_true
from .. import ne_
from .. import provide_metadata
from ..assertions import expect_raises
from ..assertions import expect_raises_message
from ..config import requirements
from ..provision import set_default_schema_on_connection
from ..schema import Column
from ..schema import Table
from ... import bindparam
from ... import dialects
from ... import event
from ... import exc
from ... import Integer
from ... import literal_column
from ... import select
from ... import String
from ...sql.compiler import Compiled
from ...util import inspect_getfullargspec


class PingTest(fixtures.TestBase):
    __backend__ = True

    def test_do_ping(self):
        with testing.db.connect() as conn:
            is_true(
                testing.db.dialect.do_ping(conn.connection.dbapi_connection)
            )


class ArgSignatureTest(fixtures.TestBase):
    """test that all visit_XYZ() in :class:`_sql.Compiler` subclasses have
    ``**kw``, for #8988.

    This test uses runtime code inspection.   Does not need to be a
    ``__backend__`` test as it only needs to run once provided all target
    dialects have been imported.

    For third party dialects, the suite would be run with that third
    party as a "--dburi", which means its compiler classes will have been
    imported by the time this test runs.

    """

    def _all_subclasses():  # type: ignore  # noqa
        for d in dialects.__all__:
            if not d.startswith("_"):
                importlib.import_module("sqlalchemy.dialects.%s" % d)

        stack = [Compiled]

        while stack:
            cls = stack.pop(0)
            stack.extend(cls.__subclasses__())
            yield cls

    @testing.fixture(params=list(_all_subclasses()))
    def all_subclasses(self, request):
        yield request.param

    def test_all_visit_methods_accept_kw(self, all_subclasses):
        cls = all_subclasses

        for k in cls.__dict__:
            if k.startswith("visit_"):
                meth = getattr(cls, k)

                insp = inspect_getfullargspec(meth)
                is_not_none(
                    insp.varkw,
                    f"Compiler visit method {cls.__name__}.{k}() does "
                    "not accommodate for **kw in its argument signature",
                )


class ExceptionTest(fixtures.TablesTest):
    """Test basic exception wrapping.

    DBAPIs vary a lot in exception behavior so to actually anticipate
    specific exceptions from real round trips, we need to be conservative.

    """

    run_deletes = "each"

    __backend__ = True

    @classmethod
    def define_tables(cls, metadata):
        Table(
            "manual_pk",
            metadata,
            Column("id", Integer, primary_key=True, autoincrement=False),
            Column("data", String(50)),
        )

    @requirements.duplicate_key_raises_integrity_error
    def test_integrity_error(self):
        with config.db.connect() as conn:
            trans = conn.begin()
            conn.execute(
                self.tables.manual_pk.insert(), {"id": 1, "data": "d1"}
            )

            assert_raises(
                exc.IntegrityError,
                conn.execute,
                self.tables.manual_pk.insert(),
                {"id": 1, "data": "d1"},
            )

            trans.rollback()

    def test_exception_with_non_ascii(self):
        with config.db.connect() as conn:
            try:
                # try to create an error message that likely has non-ascii
                # characters in the DBAPI's message string.  unfortunately
                # there's no way to make this happen with some drivers like
                # mysqlclient, pymysql.  this at least does produce a non-
                # ascii error message for cx_oracle, psycopg2
                conn.execute(select(literal_column("méil")))
                assert False
            except exc.DBAPIError as err:
                err_str = str(err)

                assert str(err.orig) in str(err)

            assert isinstance(err_str, str)


class IsolationLevelTest(fixtures.TestBase):
    __backend__ = True

    __requires__ = ("isolation_level",)

    def _get_non_default_isolation_level(self):
        levels = requirements.get_isolation_levels(config)

        default = levels["default"]
        supported = levels["supported"]

        s = set(supported).difference(["AUTOCOMMIT", default])
        if s:
            return s.pop()
        else:
            config.skip_test("no non-default isolation level available")

    def test_default_isolation_level(self):
        eq_(
            config.db.dialect.default_isolation_level,
            requirements.get_isolation_levels(config)["default"],
        )

    def test_non_default_isolation_level(self):
        non_default = self._get_non_default_isolation_level()

        with config.db.connect() as conn:
            existing = conn.get_isolation_level()

            ne_(existing, non_default)

            conn.execution_options(isolation_level=non_default)

            eq_(conn.get_isolation_level(), non_default)

            conn.dialect.reset_isolation_level(
                conn.connection.dbapi_connection
            )

            eq_(conn.get_isolation_level(), existing)

    def test_all_levels(self):
        levels = requirements.get_isolation_levels(config)

        all_levels = levels["supported"]

        for level in set(all_levels).difference(["AUTOCOMMIT"]):
            with config.db.connect() as conn:
                conn.execution_options(isolation_level=level)

                eq_(conn.get_isolation_level(), level)

                trans = conn.begin()
                trans.rollback()

                eq_(conn.get_isolation_level(), level)

            with config.db.connect() as conn:
                eq_(
                    conn.get_isolation_level(),
                    levels["default"],
                )

    @testing.requires.get_isolation_level_values
    def test_invalid_level_execution_option(self, connection_no_trans):
        """test for the new get_isolation_level_values() method"""

        connection = connection_no_trans
        with expect_raises_message(
            exc.ArgumentError,
            "Invalid value '%s' for isolation_level. "
            "Valid isolation levels for '%s' are %s"
            % (
                "FOO",
                connection.dialect.name,
                ", ".join(
                    requirements.get_isolation_levels(config)["supported"]
                ),
            ),
        ):
            connection.execution_options(isolation_level="FOO")

    @testing.requires.get_isolation_level_values
    @testing.requires.dialect_level_isolation_level_param
    def test_invalid_level_engine_param(self, testing_engine):
        """test for the new get_isolation_level_values() method
        and support for the dialect-level 'isolation_level' parameter.

        """

        eng = testing_engine(options=dict(isolation_level="FOO"))
        with expect_raises_message(
            exc.ArgumentError,
            "Invalid value '%s' for isolation_level. "
            "Valid isolation levels for '%s' are %s"
            % (
                "FOO",
                eng.dialect.name,
                ", ".join(
                    requirements.get_isolation_levels(config)["supported"]
                ),
            ),
        ):
            eng.connect()

    @testing.requires.independent_readonly_connections
    def test_dialect_user_setting_is_restored(self, testing_engine):
        levels = requirements.get_isolation_levels(config)
        default = levels["default"]
        supported = (
            sorted(
                set(levels["supported"]).difference([default, "AUTOCOMMIT"])
            )
        )[0]

        e = testing_engine(options={"isolation_level": supported})

        with e.connect() as conn:
            eq_(conn.get_isolation_level(), supported)

        with e.connect() as conn:
            conn.execution_options(isolation_level=default)
            eq_(conn.get_isolation_level(), default)

        with e.connect() as conn:
            eq_(conn.get_isolation_level(), supported)


class AutocommitIsolationTest(fixtures.TablesTest):
    run_deletes = "each"

    __requires__ = ("autocommit",)

    __backend__ = True

    @classmethod
    def define_tables(cls, metadata):
        Table(
            "some_table",
            metadata,
            Column("id", Integer, primary_key=True, autoincrement=False),
            Column("data", String(50)),
            test_needs_acid=True,
        )

    def _test_conn_autocommits(self, conn, autocommit):
        trans = conn.begin()
        conn.execute(
            self.tables.some_table.insert(), {"id": 1, "data": "some data"}
        )
        trans.rollback()

        eq_(
            conn.scalar(select(self.tables.some_table.c.id)),
            1 if autocommit else None,
        )
        conn.rollback()

        with conn.begin():
            conn.execute(self.tables.some_table.delete())

    def test_autocommit_on(self, connection_no_trans):
        conn = connection_no_trans
        c2 = conn.execution_options(isolation_level="AUTOCOMMIT")
        self._test_conn_autocommits(c2, True)

        c2.dialect.reset_isolation_level(c2.connection.dbapi_connection)

        self._test_conn_autocommits(conn, False)

    def test_autocommit_off(self, connection_no_trans):
        conn = connection_no_trans
        self._test_conn_autocommits(conn, False)

    def test_turn_autocommit_off_via_default_iso_level(
        self, connection_no_trans
    ):
        conn = connection_no_trans
        conn = conn.execution_options(isolation_level="AUTOCOMMIT")
        self._test_conn_autocommits(conn, True)

        conn.execution_options(
            isolation_level=requirements.get_isolation_levels(config)[
                "default"
            ]
        )
        self._test_conn_autocommits(conn, False)

    @testing.requires.independent_readonly_connections
    @testing.variation("use_dialect_setting", [True, False])
    def test_dialect_autocommit_is_restored(
        self, testing_engine, use_dialect_setting
    ):
        """test #10147"""

        if use_dialect_setting:
            e = testing_engine(options={"isolation_level": "AUTOCOMMIT"})
        else:
            e = testing_engine().execution_options(
                isolation_level="AUTOCOMMIT"
            )

        levels = requirements.get_isolation_levels(config)

        default = levels["default"]

        with e.connect() as conn:
            self._test_conn_autocommits(conn, True)

        with e.connect() as conn:
            conn.execution_options(isolation_level=default)
            self._test_conn_autocommits(conn, False)

        with e.connect() as conn:
            self._test_conn_autocommits(conn, True)


class EscapingTest(fixtures.TestBase):
    @provide_metadata
    def test_percent_sign_round_trip(self):
        """test that the DBAPI accommodates for escaped / nonescaped
        percent signs in a way that matches the compiler

        """
        m = self.metadata
        t = Table("t", m, Column("data", String(50)))
        t.create(config.db)
        with config.db.begin() as conn:
            conn.execute(t.insert(), dict(data="some % value"))
            conn.execute(t.insert(), dict(data="some %% other value"))

            eq_(
                conn.scalar(
                    select(t.c.data).where(
                        t.c.data == literal_column("'some % value'")
                    )
                ),
                "some % value",
            )

            eq_(
                conn.scalar(
                    select(t.c.data).where(
                        t.c.data == literal_column("'some %% other value'")
                    )
                ),
                "some %% other value",
            )


class WeCanSetDefaultSchemaWEventsTest(fixtures.TestBase):
    __backend__ = True

    __requires__ = ("default_schema_name_switch",)

    def test_control_case(self):
        default_schema_name = config.db.dialect.default_schema_name

        eng = engines.testing_engine()
        with eng.connect():
            pass

        eq_(eng.dialect.default_schema_name, default_schema_name)

    def test_wont_work_wo_insert(self):
        default_schema_name = config.db.dialect.default_schema_name

        eng = engines.testing_engine()

        @event.listens_for(eng, "connect")
        def on_connect(dbapi_connection, connection_record):
            set_default_schema_on_connection(
                config, dbapi_connection, config.test_schema
            )

        with eng.connect() as conn:
            what_it_should_be = eng.dialect._get_default_schema_name(conn)
            eq_(what_it_should_be, config.test_schema)

        eq_(eng.dialect.default_schema_name, default_schema_name)

    def test_schema_change_on_connect(self):
        eng = engines.testing_engine()

        @event.listens_for(eng, "connect", insert=True)
        def on_connect(dbapi_connection, connection_record):
            set_default_schema_on_connection(
                config, dbapi_connection, config.test_schema
            )

        with eng.connect() as conn:
            what_it_should_be = eng.dialect._get_default_schema_name(conn)
            eq_(what_it_should_be, config.test_schema)

        eq_(eng.dialect.default_schema_name, config.test_schema)

    def test_schema_change_works_w_transactions(self):
        eng = engines.testing_engine()

        @event.listens_for(eng, "connect", insert=True)
        def on_connect(dbapi_connection, *arg):
            set_default_schema_on_connection(
                config, dbapi_connection, config.test_schema
            )

        with eng.connect() as conn:
            trans = conn.begin()
            what_it_should_be = eng.dialect._get_default_schema_name(conn)
            eq_(what_it_should_be, config.test_schema)
            trans.rollback()

            what_it_should_be = eng.dialect._get_default_schema_name(conn)
            eq_(what_it_should_be, config.test_schema)

        eq_(eng.dialect.default_schema_name, config.test_schema)


class FutureWeCanSetDefaultSchemaWEventsTest(
    fixtures.FutureEngineMixin, WeCanSetDefaultSchemaWEventsTest
):
    pass


class DifficultParametersTest(fixtures.TestBase):
    __backend__ = True

    tough_parameters = testing.combinations(
        ("boring",),
        ("per cent",),
        ("per % cent",),
        ("%percent",),
        ("par(ens)",),
        ("percent%(ens)yah",),
        ("col:ons",),
        ("_starts_with_underscore",),
        ("dot.s",),
        ("more :: %colons%",),
        ("_name",),
        ("___name",),
        ("[BracketsAndCase]",),
        ("42numbers",),
        ("percent%signs",),
        ("has spaces",),
        ("/slashes/",),
        ("more/slashes",),
        ("q?marks",),
        ("1param",),
        ("1col:on",),
        argnames="paramname",
    )

    @tough_parameters
    @config.requirements.unusual_column_name_characters
    def test_round_trip_same_named_column(
        self, paramname, connection, metadata
    ):
        name = paramname

        t = Table(
            "t",
            metadata,
            Column("id", Integer, primary_key=True),
            Column(name, String(50), nullable=False),
        )

        # table is created
        t.create(connection)

        # automatic param generated by insert
        connection.execute(t.insert().values({"id": 1, name: "some name"}))

        # automatic param generated by criteria, plus selecting the column
        stmt = select(t.c[name]).where(t.c[name] == "some name")

        eq_(connection.scalar(stmt), "some name")

        # use the name in a param explicitly
        stmt = select(t.c[name]).where(t.c[name] == bindparam(name))

        row = connection.execute(stmt, {name: "some name"}).first()

        # name works as the key from cursor.description
        eq_(row._mapping[name], "some name")

        # use expanding IN
        stmt = select(t.c[name]).where(
            t.c[name].in_(["some name", "some other_name"])
        )

        row = connection.execute(stmt).first()

    @testing.fixture
    def multirow_fixture(self, metadata, connection):
        mytable = Table(
            "mytable",
            metadata,
            Column("myid", Integer),
            Column("name", String(50)),
            Column("desc", String(50)),
        )

        mytable.create(connection)

        connection.execute(
            mytable.insert(),
            [
                {"myid": 1, "name": "a", "desc": "a_desc"},
                {"myid": 2, "name": "b", "desc": "b_desc"},
                {"myid": 3, "name": "c", "desc": "c_desc"},
                {"myid": 4, "name": "d", "desc": "d_desc"},
            ],
        )
        yield mytable

    @tough_parameters
    def test_standalone_bindparam_escape(
        self, paramname, connection, multirow_fixture
    ):
        tbl1 = multirow_fixture
        stmt = select(tbl1.c.myid).where(
            tbl1.c.name == bindparam(paramname, value="x")
        )
        res = connection.scalar(stmt, {paramname: "c"})
        eq_(res, 3)

    @tough_parameters
    def test_standalone_bindparam_escape_expanding(
        self, paramname, connection, multirow_fixture
    ):
        tbl1 = multirow_fixture
        stmt = (
            select(tbl1.c.myid)
            .where(tbl1.c.name.in_(bindparam(paramname, value=["a", "b"])))
            .order_by(tbl1.c.myid)
        )

        res = connection.scalars(stmt, {paramname: ["d", "a"]}).all()
        eq_(res, [1, 4])


class ReturningGuardsTest(fixtures.TablesTest):
    """test that the various 'returning' flags are set appropriately"""

    __backend__ = True

    @classmethod
    def define_tables(cls, metadata):
        Table(
            "t",
            metadata,
            Column("id", Integer, primary_key=True, autoincrement=False),
            Column("data", String(50)),
        )

    @testing.fixture
    def run_stmt(self, connection):
        t = self.tables.t

        def go(stmt, executemany, id_param_name, expect_success):
            stmt = stmt.returning(t.c.id)

            if executemany:
                if not expect_success:
                    # for RETURNING executemany(), we raise our own
                    # error as this is independent of general RETURNING
                    # support
                    with expect_raises_message(
                        exc.StatementError,
                        rf"Dialect {connection.dialect.name}\+"
                        f"{connection.dialect.driver} with "
                        f"current server capabilities does not support "
                        f".*RETURNING when executemany is used",
                    ):
                        result = connection.execute(
                            stmt,
                            [
                                {id_param_name: 1, "data": "d1"},
                                {id_param_name: 2, "data": "d2"},
                                {id_param_name: 3, "data": "d3"},
                            ],
                        )
                else:
                    result = connection.execute(
                        stmt,
                        [
                            {id_param_name: 1, "data": "d1"},
                            {id_param_name: 2, "data": "d2"},
                            {id_param_name: 3, "data": "d3"},
                        ],
                    )
                    eq_(result.all(), [(1,), (2,), (3,)])
            else:
                if not expect_success:
                    # for RETURNING execute(), we pass all the way to the DB
                    # and let it fail
                    with expect_raises(exc.DBAPIError):
                        connection.execute(
                            stmt, {id_param_name: 1, "data": "d1"}
                        )
                else:
                    result = connection.execute(
                        stmt, {id_param_name: 1, "data": "d1"}
                    )
                    eq_(result.all(), [(1,)])

        return go

    def test_insert_single(self, connection, run_stmt):
        t = self.tables.t

        stmt = t.insert()

        run_stmt(stmt, False, "id", connection.dialect.insert_returning)

    def test_insert_many(self, connection, run_stmt):
        t = self.tables.t

        stmt = t.insert()

        run_stmt(
            stmt, True, "id", connection.dialect.insert_executemany_returning
        )

    def test_update_single(self, connection, run_stmt):
        t = self.tables.t

        connection.execute(
            t.insert(),
            [
                {"id": 1, "data": "d1"},
                {"id": 2, "data": "d2"},
                {"id": 3, "data": "d3"},
            ],
        )

        stmt = t.update().where(t.c.id == bindparam("b_id"))

        run_stmt(stmt, False, "b_id", connection.dialect.update_returning)

    def test_update_many(self, connection, run_stmt):
        t = self.tables.t

        connection.execute(
            t.insert(),
            [
                {"id": 1, "data": "d1"},
                {"id": 2, "data": "d2"},
                {"id": 3, "data": "d3"},
            ],
        )

        stmt = t.update().where(t.c.id == bindparam("b_id"))

        run_stmt(
            stmt, True, "b_id", connection.dialect.update_executemany_returning
        )

    def test_delete_single(self, connection, run_stmt):
        t = self.tables.t

        connection.execute(
            t.insert(),
            [
                {"id": 1, "data": "d1"},
                {"id": 2, "data": "d2"},
                {"id": 3, "data": "d3"},
            ],
        )

        stmt = t.delete().where(t.c.id == bindparam("b_id"))

        run_stmt(stmt, False, "b_id", connection.dialect.delete_returning)

    def test_delete_many(self, connection, run_stmt):
        t = self.tables.t

        connection.execute(
            t.insert(),
            [
                {"id": 1, "data": "d1"},
                {"id": 2, "data": "d2"},
                {"id": 3, "data": "d3"},
            ],
        )

        stmt = t.delete().where(t.c.id == bindparam("b_id"))

        run_stmt(
            stmt, True, "b_id", connection.dialect.delete_executemany_returning
        )
