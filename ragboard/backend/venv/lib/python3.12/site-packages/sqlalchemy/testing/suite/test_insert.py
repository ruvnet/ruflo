# testing/suite/test_insert.py
# Copyright (C) 2005-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php
# mypy: ignore-errors

from decimal import Decimal
import uuid

from . import testing
from .. import fixtures
from ..assertions import eq_
from ..config import requirements
from ..schema import Column
from ..schema import Table
from ... import Double
from ... import Float
from ... import Identity
from ... import Integer
from ... import literal
from ... import literal_column
from ... import Numeric
from ... import select
from ... import String
from ...types import LargeBinary
from ...types import UUID
from ...types import Uuid


class LastrowidTest(fixtures.TablesTest):
    run_deletes = "each"

    __backend__ = True

    __requires__ = "implements_get_lastrowid", "autoincrement_insert"

    @classmethod
    def define_tables(cls, metadata):
        Table(
            "autoinc_pk",
            metadata,
            Column(
                "id", Integer, primary_key=True, test_needs_autoincrement=True
            ),
            Column("data", String(50)),
            implicit_returning=False,
        )

        Table(
            "manual_pk",
            metadata,
            Column("id", Integer, primary_key=True, autoincrement=False),
            Column("data", String(50)),
            implicit_returning=False,
        )

    def _assert_round_trip(self, table, conn):
        row = conn.execute(table.select()).first()
        eq_(
            row,
            (
                conn.dialect.default_sequence_base,
                "some data",
            ),
        )

    def test_autoincrement_on_insert(self, connection):
        connection.execute(
            self.tables.autoinc_pk.insert(), dict(data="some data")
        )
        self._assert_round_trip(self.tables.autoinc_pk, connection)

    def test_last_inserted_id(self, connection):
        r = connection.execute(
            self.tables.autoinc_pk.insert(), dict(data="some data")
        )
        pk = connection.scalar(select(self.tables.autoinc_pk.c.id))
        eq_(r.inserted_primary_key, (pk,))

    @requirements.dbapi_lastrowid
    def test_native_lastrowid_autoinc(self, connection):
        r = connection.execute(
            self.tables.autoinc_pk.insert(), dict(data="some data")
        )
        lastrowid = r.lastrowid
        pk = connection.scalar(select(self.tables.autoinc_pk.c.id))
        eq_(lastrowid, pk)


class InsertBehaviorTest(fixtures.TablesTest):
    run_deletes = "each"
    __backend__ = True

    @classmethod
    def define_tables(cls, metadata):
        Table(
            "autoinc_pk",
            metadata,
            Column(
                "id", Integer, primary_key=True, test_needs_autoincrement=True
            ),
            Column("data", String(50)),
        )
        Table(
            "manual_pk",
            metadata,
            Column("id", Integer, primary_key=True, autoincrement=False),
            Column("data", String(50)),
        )
        Table(
            "no_implicit_returning",
            metadata,
            Column(
                "id", Integer, primary_key=True, test_needs_autoincrement=True
            ),
            Column("data", String(50)),
            implicit_returning=False,
        )
        Table(
            "includes_defaults",
            metadata,
            Column(
                "id", Integer, primary_key=True, test_needs_autoincrement=True
            ),
            Column("data", String(50)),
            Column("x", Integer, default=5),
            Column(
                "y",
                Integer,
                default=literal_column("2", type_=Integer) + literal(2),
            ),
        )

    @testing.variation("style", ["plain", "return_defaults"])
    @testing.variation("executemany", [True, False])
    def test_no_results_for_non_returning_insert(
        self, connection, style, executemany
    ):
        """test another INSERT issue found during #10453"""

        table = self.tables.no_implicit_returning

        stmt = table.insert()
        if style.return_defaults:
            stmt = stmt.return_defaults()

        if executemany:
            data = [
                {"data": "d1"},
                {"data": "d2"},
                {"data": "d3"},
                {"data": "d4"},
                {"data": "d5"},
            ]
        else:
            data = {"data": "d1"}

        r = connection.execute(stmt, data)
        assert not r.returns_rows

    @requirements.autoincrement_insert
    def test_autoclose_on_insert(self, connection):
        r = connection.execute(
            self.tables.autoinc_pk.insert(), dict(data="some data")
        )
        assert r._soft_closed
        assert not r.closed
        assert r.is_insert

        # new as of I8091919d45421e3f53029b8660427f844fee0228; for the moment
        # an insert where the PK was taken from a row that the dialect
        # selected, as is the case for mssql/pyodbc, will still report
        # returns_rows as true because there's a cursor description.  in that
        # case, the row had to have been consumed at least.
        assert not r.returns_rows or r.fetchone() is None

    @requirements.insert_returning
    def test_autoclose_on_insert_implicit_returning(self, connection):
        r = connection.execute(
            # return_defaults() ensures RETURNING will be used,
            # new in 2.0 as sqlite/mariadb offer both RETURNING and
            # cursor.lastrowid
            self.tables.autoinc_pk.insert().return_defaults(),
            dict(data="some data"),
        )
        assert r._soft_closed
        assert not r.closed
        assert r.is_insert

        # note we are experimenting with having this be True
        # as of I8091919d45421e3f53029b8660427f844fee0228 .
        # implicit returning has fetched the row, but it still is a
        # "returns rows"
        assert r.returns_rows

        # and we should be able to fetchone() on it, we just get no row
        eq_(r.fetchone(), None)

        # and the keys, etc.
        eq_(r.keys(), ["id"])

        # but the dialect took in the row already.   not really sure
        # what the best behavior is.

    @requirements.empty_inserts
    def test_empty_insert(self, connection):
        r = connection.execute(self.tables.autoinc_pk.insert())
        assert r._soft_closed
        assert not r.closed

        r = connection.execute(
            self.tables.autoinc_pk.select().where(
                self.tables.autoinc_pk.c.id != None
            )
        )
        eq_(len(r.all()), 1)

    @requirements.empty_inserts_executemany
    def test_empty_insert_multiple(self, connection):
        r = connection.execute(self.tables.autoinc_pk.insert(), [{}, {}, {}])
        assert r._soft_closed
        assert not r.closed

        r = connection.execute(
            self.tables.autoinc_pk.select().where(
                self.tables.autoinc_pk.c.id != None
            )
        )

        eq_(len(r.all()), 3)

    @requirements.insert_from_select
    def test_insert_from_select_autoinc(self, connection):
        src_table = self.tables.manual_pk
        dest_table = self.tables.autoinc_pk
        connection.execute(
            src_table.insert(),
            [
                dict(id=1, data="data1"),
                dict(id=2, data="data2"),
                dict(id=3, data="data3"),
            ],
        )

        result = connection.execute(
            dest_table.insert().from_select(
                ("data",),
                select(src_table.c.data).where(
                    src_table.c.data.in_(["data2", "data3"])
                ),
            )
        )

        eq_(result.inserted_primary_key, (None,))

        result = connection.execute(
            select(dest_table.c.data).order_by(dest_table.c.data)
        )
        eq_(result.fetchall(), [("data2",), ("data3",)])

    @requirements.insert_from_select
    def test_insert_from_select_autoinc_no_rows(self, connection):
        src_table = self.tables.manual_pk
        dest_table = self.tables.autoinc_pk

        result = connection.execute(
            dest_table.insert().from_select(
                ("data",),
                select(src_table.c.data).where(
                    src_table.c.data.in_(["data2", "data3"])
                ),
            )
        )
        eq_(result.inserted_primary_key, (None,))

        result = connection.execute(
            select(dest_table.c.data).order_by(dest_table.c.data)
        )

        eq_(result.fetchall(), [])

    @requirements.insert_from_select
    def test_insert_from_select(self, connection):
        table = self.tables.manual_pk
        connection.execute(
            table.insert(),
            [
                dict(id=1, data="data1"),
                dict(id=2, data="data2"),
                dict(id=3, data="data3"),
            ],
        )

        connection.execute(
            table.insert()
            .inline()
            .from_select(
                ("id", "data"),
                select(table.c.id + 5, table.c.data).where(
                    table.c.data.in_(["data2", "data3"])
                ),
            )
        )

        eq_(
            connection.execute(
                select(table.c.data).order_by(table.c.data)
            ).fetchall(),
            [("data1",), ("data2",), ("data2",), ("data3",), ("data3",)],
        )

    @requirements.insert_from_select
    def test_insert_from_select_with_defaults(self, connection):
        table = self.tables.includes_defaults
        connection.execute(
            table.insert(),
            [
                dict(id=1, data="data1"),
                dict(id=2, data="data2"),
                dict(id=3, data="data3"),
            ],
        )

        connection.execute(
            table.insert()
            .inline()
            .from_select(
                ("id", "data"),
                select(table.c.id + 5, table.c.data).where(
                    table.c.data.in_(["data2", "data3"])
                ),
            )
        )

        eq_(
            connection.execute(
                select(table).order_by(table.c.data, table.c.id)
            ).fetchall(),
            [
                (1, "data1", 5, 4),
                (2, "data2", 5, 4),
                (7, "data2", 5, 4),
                (3, "data3", 5, 4),
                (8, "data3", 5, 4),
            ],
        )


class ReturningTest(fixtures.TablesTest):
    run_create_tables = "each"
    __requires__ = "insert_returning", "autoincrement_insert"
    __backend__ = True

    def _assert_round_trip(self, table, conn):
        row = conn.execute(table.select()).first()
        eq_(
            row,
            (
                conn.dialect.default_sequence_base,
                "some data",
            ),
        )

    @classmethod
    def define_tables(cls, metadata):
        Table(
            "autoinc_pk",
            metadata,
            Column(
                "id", Integer, primary_key=True, test_needs_autoincrement=True
            ),
            Column("data", String(50)),
        )

    @requirements.fetch_rows_post_commit
    def test_explicit_returning_pk_autocommit(self, connection):
        table = self.tables.autoinc_pk
        r = connection.execute(
            table.insert().returning(table.c.id), dict(data="some data")
        )
        pk = r.first()[0]
        fetched_pk = connection.scalar(select(table.c.id))
        eq_(fetched_pk, pk)

    def test_explicit_returning_pk_no_autocommit(self, connection):
        table = self.tables.autoinc_pk
        r = connection.execute(
            table.insert().returning(table.c.id), dict(data="some data")
        )

        pk = r.first()[0]
        fetched_pk = connection.scalar(select(table.c.id))
        eq_(fetched_pk, pk)

    def test_autoincrement_on_insert_implicit_returning(self, connection):
        connection.execute(
            self.tables.autoinc_pk.insert(), dict(data="some data")
        )
        self._assert_round_trip(self.tables.autoinc_pk, connection)

    def test_last_inserted_id_implicit_returning(self, connection):
        r = connection.execute(
            self.tables.autoinc_pk.insert(), dict(data="some data")
        )
        pk = connection.scalar(select(self.tables.autoinc_pk.c.id))
        eq_(r.inserted_primary_key, (pk,))

    @requirements.insert_executemany_returning
    def test_insertmanyvalues_returning(self, connection):
        r = connection.execute(
            self.tables.autoinc_pk.insert().returning(
                self.tables.autoinc_pk.c.id
            ),
            [
                {"data": "d1"},
                {"data": "d2"},
                {"data": "d3"},
                {"data": "d4"},
                {"data": "d5"},
            ],
        )
        rall = r.all()

        pks = connection.execute(select(self.tables.autoinc_pk.c.id))

        eq_(rall, pks.all())

    @testing.combinations(
        (Double(), 8.5514716, True),
        (
            Double(53),
            8.5514716,
            True,
            testing.requires.float_or_double_precision_behaves_generically,
        ),
        (Float(), 8.5514, True),
        (
            Float(8),
            8.5514,
            True,
            testing.requires.float_or_double_precision_behaves_generically,
        ),
        (
            Numeric(precision=15, scale=12, asdecimal=False),
            8.5514716,
            True,
            testing.requires.literal_float_coercion,
        ),
        (
            Numeric(precision=15, scale=12, asdecimal=True),
            Decimal("8.5514716"),
            False,
        ),
        argnames="type_,value,do_rounding",
    )
    @testing.variation("sort_by_parameter_order", [True, False])
    @testing.variation("multiple_rows", [True, False])
    def test_insert_w_floats(
        self,
        connection,
        metadata,
        sort_by_parameter_order,
        type_,
        value,
        do_rounding,
        multiple_rows,
    ):
        """test #9701.

        this tests insertmanyvalues as well as decimal / floating point
        RETURNING types

        """

        t = Table(
            # Oracle backends seems to be getting confused if
            # this table is named the same as the one
            # in test_imv_returning_datatypes.  use a different name
            "f_t",
            metadata,
            Column("id", Integer, Identity(), primary_key=True),
            Column("value", type_),
        )

        t.create(connection)

        result = connection.execute(
            t.insert().returning(
                t.c.id,
                t.c.value,
                sort_by_parameter_order=bool(sort_by_parameter_order),
            ),
            [{"value": value} for i in range(10)]
            if multiple_rows
            else {"value": value},
        )

        if multiple_rows:
            i_range = range(1, 11)
        else:
            i_range = range(1, 2)

        # we want to test only that we are getting floating points back
        # with some degree of the original value maintained, that it is not
        # being truncated to an integer.  there's too much variation in how
        # drivers return floats, which should not be relied upon to be
        # exact, for us to just compare as is (works for PG drivers but not
        # others) so we use rounding here.  There's precedent for this
        # in suite/test_types.py::NumericTest as well

        if do_rounding:
            eq_(
                {(id_, round(val_, 5)) for id_, val_ in result},
                {(id_, round(value, 5)) for id_ in i_range},
            )

            eq_(
                {
                    round(val_, 5)
                    for val_ in connection.scalars(select(t.c.value))
                },
                {round(value, 5)},
            )
        else:
            eq_(
                set(result),
                {(id_, value) for id_ in i_range},
            )

            eq_(
                set(connection.scalars(select(t.c.value))),
                {value},
            )

    @testing.combinations(
        (
            "non_native_uuid",
            Uuid(native_uuid=False),
            uuid.uuid4(),
        ),
        (
            "non_native_uuid_str",
            Uuid(as_uuid=False, native_uuid=False),
            str(uuid.uuid4()),
        ),
        (
            "generic_native_uuid",
            Uuid(native_uuid=True),
            uuid.uuid4(),
            testing.requires.uuid_data_type,
        ),
        ("UUID", UUID(), uuid.uuid4(), testing.requires.uuid_data_type),
        (
            "LargeBinary1",
            LargeBinary(),
            b"this is binary",
        ),
        ("LargeBinary2", LargeBinary(), b"7\xe7\x9f"),
        argnames="type_,value",
        id_="iaa",
    )
    @testing.variation("sort_by_parameter_order", [True, False])
    @testing.variation("multiple_rows", [True, False])
    @testing.requires.insert_returning
    def test_imv_returning_datatypes(
        self,
        connection,
        metadata,
        sort_by_parameter_order,
        type_,
        value,
        multiple_rows,
    ):
        """test #9739, #9808 (similar to #9701).

        this tests insertmanyvalues in conjunction with various datatypes.

        These tests are particularly for the asyncpg driver which needs
        most types to be explicitly cast for the new IMV format

        """
        t = Table(
            "d_t",
            metadata,
            Column("id", Integer, Identity(), primary_key=True),
            Column("value", type_),
        )

        t.create(connection)

        result = connection.execute(
            t.insert().returning(
                t.c.id,
                t.c.value,
                sort_by_parameter_order=bool(sort_by_parameter_order),
            ),
            [{"value": value} for i in range(10)]
            if multiple_rows
            else {"value": value},
        )

        if multiple_rows:
            i_range = range(1, 11)
        else:
            i_range = range(1, 2)

        eq_(
            set(result),
            {(id_, value) for id_ in i_range},
        )

        eq_(
            set(connection.scalars(select(t.c.value))),
            {value},
        )


__all__ = ("LastrowidTest", "InsertBehaviorTest", "ReturningTest")
