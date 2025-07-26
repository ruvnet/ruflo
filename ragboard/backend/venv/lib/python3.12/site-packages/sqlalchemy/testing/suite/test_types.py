# testing/suite/test_types.py
# Copyright (C) 2005-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php
# mypy: ignore-errors


import datetime
import decimal
import json
import re
import uuid

from .. import config
from .. import engines
from .. import fixtures
from .. import mock
from ..assertions import eq_
from ..assertions import is_
from ..assertions import ne_
from ..config import requirements
from ..schema import Column
from ..schema import Table
from ... import and_
from ... import ARRAY
from ... import BigInteger
from ... import bindparam
from ... import Boolean
from ... import case
from ... import cast
from ... import Date
from ... import DateTime
from ... import Float
from ... import Integer
from ... import Interval
from ... import JSON
from ... import literal
from ... import literal_column
from ... import MetaData
from ... import null
from ... import Numeric
from ... import select
from ... import String
from ... import testing
from ... import Text
from ... import Time
from ... import TIMESTAMP
from ... import type_coerce
from ... import TypeDecorator
from ... import Unicode
from ... import UnicodeText
from ... import UUID
from ... import Uuid
from ...orm import declarative_base
from ...orm import Session
from ...sql import sqltypes
from ...sql.sqltypes import LargeBinary
from ...sql.sqltypes import PickleType


class _LiteralRoundTripFixture:
    supports_whereclause = True

    @testing.fixture
    def literal_round_trip(self, metadata, connection):
        """test literal rendering"""

        # for literal, we test the literal render in an INSERT
        # into a typed column.  we can then SELECT it back as its
        # official type; ideally we'd be able to use CAST here
        # but MySQL in particular can't CAST fully

        def run(
            type_,
            input_,
            output,
            filter_=None,
            compare=None,
            support_whereclause=True,
        ):
            t = Table("t", metadata, Column("x", type_))
            t.create(connection)

            for value in input_:
                ins = t.insert().values(
                    x=literal(value, type_, literal_execute=True)
                )
                connection.execute(ins)

            ins = t.insert().values(
                x=literal(None, type_, literal_execute=True)
            )
            connection.execute(ins)

            if support_whereclause and self.supports_whereclause:
                if compare:
                    stmt = t.select().where(
                        t.c.x
                        == literal(
                            compare,
                            type_,
                            literal_execute=True,
                        ),
                        t.c.x
                        == literal(
                            input_[0],
                            type_,
                            literal_execute=True,
                        ),
                    )
                else:
                    stmt = t.select().where(
                        t.c.x
                        == literal(
                            compare if compare is not None else input_[0],
                            type_,
                            literal_execute=True,
                        )
                    )
            else:
                stmt = t.select().where(t.c.x.is_not(None))

            rows = connection.execute(stmt).all()
            assert rows, "No rows returned"
            for row in rows:
                value = row[0]
                if filter_ is not None:
                    value = filter_(value)
                assert value in output

            stmt = t.select().where(t.c.x.is_(None))
            rows = connection.execute(stmt).all()
            eq_(rows, [(None,)])

        return run


class _UnicodeFixture(_LiteralRoundTripFixture, fixtures.TestBase):
    __requires__ = ("unicode_data",)

    data = (
        "Alors vous imaginez ma 🐍 surprise, au lever du jour, "
        "quand une drôle de petite 🐍 voix m’a réveillé. Elle "
        "disait: « S’il vous plaît… dessine-moi 🐍 un mouton! »"
    )

    @property
    def supports_whereclause(self):
        return config.requirements.expressions_against_unbounded_text.enabled

    @classmethod
    def define_tables(cls, metadata):
        Table(
            "unicode_table",
            metadata,
            Column(
                "id", Integer, primary_key=True, test_needs_autoincrement=True
            ),
            Column("unicode_data", cls.datatype),
        )

    def test_round_trip(self, connection):
        unicode_table = self.tables.unicode_table

        connection.execute(
            unicode_table.insert(), {"id": 1, "unicode_data": self.data}
        )

        row = connection.execute(select(unicode_table.c.unicode_data)).first()

        eq_(row, (self.data,))
        assert isinstance(row[0], str)

    def test_round_trip_executemany(self, connection):
        unicode_table = self.tables.unicode_table

        connection.execute(
            unicode_table.insert(),
            [{"id": i, "unicode_data": self.data} for i in range(1, 4)],
        )

        rows = connection.execute(
            select(unicode_table.c.unicode_data)
        ).fetchall()
        eq_(rows, [(self.data,) for i in range(1, 4)])
        for row in rows:
            assert isinstance(row[0], str)

    def _test_null_strings(self, connection):
        unicode_table = self.tables.unicode_table

        connection.execute(
            unicode_table.insert(), {"id": 1, "unicode_data": None}
        )
        row = connection.execute(select(unicode_table.c.unicode_data)).first()
        eq_(row, (None,))

    def _test_empty_strings(self, connection):
        unicode_table = self.tables.unicode_table

        connection.execute(
            unicode_table.insert(), {"id": 1, "unicode_data": ""}
        )
        row = connection.execute(select(unicode_table.c.unicode_data)).first()
        eq_(row, ("",))

    def test_literal(self, literal_round_trip):
        literal_round_trip(self.datatype, [self.data], [self.data])

    def test_literal_non_ascii(self, literal_round_trip):
        literal_round_trip(self.datatype, ["réve🐍 illé"], ["réve🐍 illé"])


class UnicodeVarcharTest(_UnicodeFixture, fixtures.TablesTest):
    __requires__ = ("unicode_data",)
    __backend__ = True

    datatype = Unicode(255)

    @requirements.empty_strings_varchar
    def test_empty_strings_varchar(self, connection):
        self._test_empty_strings(connection)

    def test_null_strings_varchar(self, connection):
        self._test_null_strings(connection)


class UnicodeTextTest(_UnicodeFixture, fixtures.TablesTest):
    __requires__ = "unicode_data", "text_type"
    __backend__ = True

    datatype = UnicodeText()

    @requirements.empty_strings_text
    def test_empty_strings_text(self, connection):
        self._test_empty_strings(connection)

    def test_null_strings_text(self, connection):
        self._test_null_strings(connection)


class ArrayTest(_LiteralRoundTripFixture, fixtures.TablesTest):
    """Add ARRAY test suite, #8138.

    This only works on PostgreSQL right now.

    """

    __requires__ = ("array_type",)
    __backend__ = True

    @classmethod
    def define_tables(cls, metadata):
        Table(
            "array_table",
            metadata,
            Column(
                "id", Integer, primary_key=True, test_needs_autoincrement=True
            ),
            Column("single_dim", ARRAY(Integer)),
            Column("multi_dim", ARRAY(String, dimensions=2)),
        )

    def test_array_roundtrip(self, connection):
        array_table = self.tables.array_table

        connection.execute(
            array_table.insert(),
            {
                "id": 1,
                "single_dim": [1, 2, 3],
                "multi_dim": [["one", "two"], ["thr'ee", "réve🐍 illé"]],
            },
        )
        row = connection.execute(
            select(array_table.c.single_dim, array_table.c.multi_dim)
        ).first()
        eq_(row, ([1, 2, 3], [["one", "two"], ["thr'ee", "réve🐍 illé"]]))

    def test_literal_simple(self, literal_round_trip):
        literal_round_trip(
            ARRAY(Integer),
            ([1, 2, 3],),
            ([1, 2, 3],),
            support_whereclause=False,
        )

    def test_literal_complex(self, literal_round_trip):
        literal_round_trip(
            ARRAY(String, dimensions=2),
            ([["one", "two"], ["thr'ee", "réve🐍 illé"]],),
            ([["one", "two"], ["thr'ee", "réve🐍 illé"]],),
            support_whereclause=False,
        )


class BinaryTest(_LiteralRoundTripFixture, fixtures.TablesTest):
    __backend__ = True

    @classmethod
    def define_tables(cls, metadata):
        Table(
            "binary_table",
            metadata,
            Column(
                "id", Integer, primary_key=True, test_needs_autoincrement=True
            ),
            Column("binary_data", LargeBinary),
            Column("pickle_data", PickleType),
        )

    @testing.combinations(b"this is binary", b"7\xe7\x9f", argnames="data")
    def test_binary_roundtrip(self, connection, data):
        binary_table = self.tables.binary_table

        connection.execute(
            binary_table.insert(), {"id": 1, "binary_data": data}
        )
        row = connection.execute(select(binary_table.c.binary_data)).first()
        eq_(row, (data,))

    def test_pickle_roundtrip(self, connection):
        binary_table = self.tables.binary_table

        connection.execute(
            binary_table.insert(),
            {"id": 1, "pickle_data": {"foo": [1, 2, 3], "bar": "bat"}},
        )
        row = connection.execute(select(binary_table.c.pickle_data)).first()
        eq_(row, ({"foo": [1, 2, 3], "bar": "bat"},))


class TextTest(_LiteralRoundTripFixture, fixtures.TablesTest):
    __requires__ = ("text_type",)
    __backend__ = True

    @property
    def supports_whereclause(self):
        return config.requirements.expressions_against_unbounded_text.enabled

    @classmethod
    def define_tables(cls, metadata):
        Table(
            "text_table",
            metadata,
            Column(
                "id", Integer, primary_key=True, test_needs_autoincrement=True
            ),
            Column("text_data", Text),
        )

    def test_text_roundtrip(self, connection):
        text_table = self.tables.text_table

        connection.execute(
            text_table.insert(), {"id": 1, "text_data": "some text"}
        )
        row = connection.execute(select(text_table.c.text_data)).first()
        eq_(row, ("some text",))

    @testing.requires.empty_strings_text
    def test_text_empty_strings(self, connection):
        text_table = self.tables.text_table

        connection.execute(text_table.insert(), {"id": 1, "text_data": ""})
        row = connection.execute(select(text_table.c.text_data)).first()
        eq_(row, ("",))

    def test_text_null_strings(self, connection):
        text_table = self.tables.text_table

        connection.execute(text_table.insert(), {"id": 1, "text_data": None})
        row = connection.execute(select(text_table.c.text_data)).first()
        eq_(row, (None,))

    def test_literal(self, literal_round_trip):
        literal_round_trip(Text, ["some text"], ["some text"])

    @requirements.unicode_data_no_special_types
    def test_literal_non_ascii(self, literal_round_trip):
        literal_round_trip(Text, ["réve🐍 illé"], ["réve🐍 illé"])

    def test_literal_quoting(self, literal_round_trip):
        data = """some 'text' hey "hi there" that's text"""
        literal_round_trip(Text, [data], [data])

    def test_literal_backslashes(self, literal_round_trip):
        data = r"backslash one \ backslash two \\ end"
        literal_round_trip(Text, [data], [data])

    def test_literal_percentsigns(self, literal_round_trip):
        data = r"percent % signs %% percent"
        literal_round_trip(Text, [data], [data])


class StringTest(_LiteralRoundTripFixture, fixtures.TestBase):
    __backend__ = True

    @requirements.unbounded_varchar
    def test_nolength_string(self):
        metadata = MetaData()
        foo = Table("foo", metadata, Column("one", String))

        foo.create(config.db)
        foo.drop(config.db)

    def test_literal(self, literal_round_trip):
        # note that in Python 3, this invokes the Unicode
        # datatype for the literal part because all strings are unicode
        literal_round_trip(String(40), ["some text"], ["some text"])

    @requirements.unicode_data_no_special_types
    def test_literal_non_ascii(self, literal_round_trip):
        literal_round_trip(String(40), ["réve🐍 illé"], ["réve🐍 illé"])

    @testing.combinations(
        ("%B%", ["AB", "BC"]),
        ("A%C", ["AC"]),
        ("A%C%Z", []),
        argnames="expr, expected",
    )
    def test_dont_truncate_rightside(
        self, metadata, connection, expr, expected
    ):
        t = Table("t", metadata, Column("x", String(2)))
        t.create(connection)

        connection.execute(t.insert(), [{"x": "AB"}, {"x": "BC"}, {"x": "AC"}])

        eq_(
            connection.scalars(select(t.c.x).where(t.c.x.like(expr))).all(),
            expected,
        )

    def test_literal_quoting(self, literal_round_trip):
        data = """some 'text' hey "hi there" that's text"""
        literal_round_trip(String(40), [data], [data])

    def test_literal_backslashes(self, literal_round_trip):
        data = r"backslash one \ backslash two \\ end"
        literal_round_trip(String(40), [data], [data])

    def test_concatenate_binary(self, connection):
        """dialects with special string concatenation operators should
        implement visit_concat_op_binary() and visit_concat_op_clauselist()
        in their compiler.

        .. versionchanged:: 2.0  visit_concat_op_clauselist() is also needed
           for dialects to override the string concatenation operator.

        """
        eq_(connection.scalar(select(literal("a") + "b")), "ab")

    def test_concatenate_clauselist(self, connection):
        """dialects with special string concatenation operators should
        implement visit_concat_op_binary() and visit_concat_op_clauselist()
        in their compiler.

        .. versionchanged:: 2.0  visit_concat_op_clauselist() is also needed
           for dialects to override the string concatenation operator.

        """
        eq_(
            connection.scalar(select(literal("a") + "b" + "c" + "d" + "e")),
            "abcde",
        )


class IntervalTest(_LiteralRoundTripFixture, fixtures.TestBase):
    __requires__ = ("datetime_interval",)
    __backend__ = True

    datatype = Interval
    data = datetime.timedelta(days=1, seconds=4)

    def test_literal(self, literal_round_trip):
        literal_round_trip(self.datatype, [self.data], [self.data])

    def test_select_direct_literal_interval(self, connection):
        row = connection.execute(select(literal(self.data))).first()
        eq_(row, (self.data,))

    def test_arithmetic_operation_literal_interval(self, connection):
        now = datetime.datetime.now().replace(microsecond=0)
        # Able to subtract
        row = connection.execute(
            select(literal(now) - literal(self.data))
        ).scalar()
        eq_(row, now - self.data)

        # Able to Add
        row = connection.execute(
            select(literal(now) + literal(self.data))
        ).scalar()
        eq_(row, now + self.data)

    @testing.fixture
    def arithmetic_table_fixture(cls, metadata, connection):
        class Decorated(TypeDecorator):
            impl = cls.datatype
            cache_ok = True

        it = Table(
            "interval_table",
            metadata,
            Column(
                "id", Integer, primary_key=True, test_needs_autoincrement=True
            ),
            Column("interval_data", cls.datatype),
            Column("date_data", DateTime),
            Column("decorated_interval_data", Decorated),
        )
        it.create(connection)
        return it

    def test_arithmetic_operation_table_interval_and_literal_interval(
        self, connection, arithmetic_table_fixture
    ):
        interval_table = arithmetic_table_fixture
        data = datetime.timedelta(days=2, seconds=5)
        connection.execute(
            interval_table.insert(), {"id": 1, "interval_data": data}
        )
        # Subtraction Operation
        value = connection.execute(
            select(interval_table.c.interval_data - literal(self.data))
        ).scalar()
        eq_(value, data - self.data)

        # Addition Operation
        value = connection.execute(
            select(interval_table.c.interval_data + literal(self.data))
        ).scalar()
        eq_(value, data + self.data)

    def test_arithmetic_operation_table_date_and_literal_interval(
        self, connection, arithmetic_table_fixture
    ):
        interval_table = arithmetic_table_fixture
        now = datetime.datetime.now().replace(microsecond=0)
        connection.execute(
            interval_table.insert(), {"id": 1, "date_data": now}
        )
        # Subtraction Operation
        value = connection.execute(
            select(interval_table.c.date_data - literal(self.data))
        ).scalar()
        eq_(value, (now - self.data))

        # Addition Operation
        value = connection.execute(
            select(interval_table.c.date_data + literal(self.data))
        ).scalar()
        eq_(value, (now + self.data))


class PrecisionIntervalTest(IntervalTest):
    __requires__ = ("datetime_interval",)
    __backend__ = True

    datatype = Interval(day_precision=9, second_precision=9)
    data = datetime.timedelta(days=103, seconds=4)


class _DateFixture(_LiteralRoundTripFixture, fixtures.TestBase):
    compare = None

    @classmethod
    def define_tables(cls, metadata):
        class Decorated(TypeDecorator):
            impl = cls.datatype
            cache_ok = True

        Table(
            "date_table",
            metadata,
            Column(
                "id", Integer, primary_key=True, test_needs_autoincrement=True
            ),
            Column("date_data", cls.datatype),
            Column("decorated_date_data", Decorated),
        )

    def test_round_trip(self, connection):
        date_table = self.tables.date_table

        connection.execute(
            date_table.insert(), {"id": 1, "date_data": self.data}
        )

        row = connection.execute(select(date_table.c.date_data)).first()

        compare = self.compare or self.data
        eq_(row, (compare,))
        assert isinstance(row[0], type(compare))

    def test_round_trip_decorated(self, connection):
        date_table = self.tables.date_table

        connection.execute(
            date_table.insert(), {"id": 1, "decorated_date_data": self.data}
        )

        row = connection.execute(
            select(date_table.c.decorated_date_data)
        ).first()

        compare = self.compare or self.data
        eq_(row, (compare,))
        assert isinstance(row[0], type(compare))

    def test_null(self, connection):
        date_table = self.tables.date_table

        connection.execute(date_table.insert(), {"id": 1, "date_data": None})

        row = connection.execute(select(date_table.c.date_data)).first()
        eq_(row, (None,))

    @testing.requires.datetime_literals
    def test_literal(self, literal_round_trip):
        compare = self.compare or self.data

        literal_round_trip(
            self.datatype, [self.data], [compare], compare=compare
        )

    @testing.requires.standalone_null_binds_whereclause
    def test_null_bound_comparison(self):
        # this test is based on an Oracle issue observed in #4886.
        # passing NULL for an expression that needs to be interpreted as
        # a certain type, does the DBAPI have the info it needs to do this.
        date_table = self.tables.date_table
        with config.db.begin() as conn:
            result = conn.execute(
                date_table.insert(), {"id": 1, "date_data": self.data}
            )
            id_ = result.inserted_primary_key[0]
            stmt = select(date_table.c.id).where(
                case(
                    (
                        bindparam("foo", type_=self.datatype) != None,
                        bindparam("foo", type_=self.datatype),
                    ),
                    else_=date_table.c.date_data,
                )
                == date_table.c.date_data
            )

            row = conn.execute(stmt, {"foo": None}).first()
            eq_(row[0], id_)


class DateTimeTest(_DateFixture, fixtures.TablesTest):
    __requires__ = ("datetime",)
    __backend__ = True
    datatype = DateTime
    data = datetime.datetime(2012, 10, 15, 12, 57, 18)

    @testing.requires.datetime_implicit_bound
    def test_select_direct(self, connection):
        result = connection.scalar(select(literal(self.data)))
        eq_(result, self.data)


class DateTimeTZTest(_DateFixture, fixtures.TablesTest):
    __requires__ = ("datetime_timezone",)
    __backend__ = True
    datatype = DateTime(timezone=True)
    data = datetime.datetime(
        2012, 10, 15, 12, 57, 18, tzinfo=datetime.timezone.utc
    )

    @testing.requires.datetime_implicit_bound
    def test_select_direct(self, connection):
        result = connection.scalar(select(literal(self.data)))
        eq_(result, self.data)


class DateTimeMicrosecondsTest(_DateFixture, fixtures.TablesTest):
    __requires__ = ("datetime_microseconds",)
    __backend__ = True
    datatype = DateTime
    data = datetime.datetime(2012, 10, 15, 12, 57, 18, 39642)


class TimestampMicrosecondsTest(_DateFixture, fixtures.TablesTest):
    __requires__ = ("timestamp_microseconds",)
    __backend__ = True
    datatype = TIMESTAMP
    data = datetime.datetime(2012, 10, 15, 12, 57, 18, 396)

    @testing.requires.timestamp_microseconds_implicit_bound
    def test_select_direct(self, connection):
        result = connection.scalar(select(literal(self.data)))
        eq_(result, self.data)


class TimeTest(_DateFixture, fixtures.TablesTest):
    __requires__ = ("time",)
    __backend__ = True
    datatype = Time
    data = datetime.time(12, 57, 18)

    @testing.requires.time_implicit_bound
    def test_select_direct(self, connection):
        result = connection.scalar(select(literal(self.data)))
        eq_(result, self.data)


class TimeTZTest(_DateFixture, fixtures.TablesTest):
    __requires__ = ("time_timezone",)
    __backend__ = True
    datatype = Time(timezone=True)
    data = datetime.time(12, 57, 18, tzinfo=datetime.timezone.utc)

    @testing.requires.time_implicit_bound
    def test_select_direct(self, connection):
        result = connection.scalar(select(literal(self.data)))
        eq_(result, self.data)


class TimeMicrosecondsTest(_DateFixture, fixtures.TablesTest):
    __requires__ = ("time_microseconds",)
    __backend__ = True
    datatype = Time
    data = datetime.time(12, 57, 18, 396)

    @testing.requires.time_implicit_bound
    def test_select_direct(self, connection):
        result = connection.scalar(select(literal(self.data)))
        eq_(result, self.data)


class DateTest(_DateFixture, fixtures.TablesTest):
    __requires__ = ("date",)
    __backend__ = True
    datatype = Date
    data = datetime.date(2012, 10, 15)

    @testing.requires.date_implicit_bound
    def test_select_direct(self, connection):
        result = connection.scalar(select(literal(self.data)))
        eq_(result, self.data)


class DateTimeCoercedToDateTimeTest(_DateFixture, fixtures.TablesTest):
    """this particular suite is testing that datetime parameters get
    coerced to dates, which tends to be something DBAPIs do.

    """

    __requires__ = "date", "date_coerces_from_datetime"
    __backend__ = True
    datatype = Date
    data = datetime.datetime(2012, 10, 15, 12, 57, 18)
    compare = datetime.date(2012, 10, 15)

    @testing.requires.datetime_implicit_bound
    def test_select_direct(self, connection):
        result = connection.scalar(select(literal(self.data)))
        eq_(result, self.data)


class DateTimeHistoricTest(_DateFixture, fixtures.TablesTest):
    __requires__ = ("datetime_historic",)
    __backend__ = True
    datatype = DateTime
    data = datetime.datetime(1850, 11, 10, 11, 52, 35)

    @testing.requires.date_implicit_bound
    def test_select_direct(self, connection):
        result = connection.scalar(select(literal(self.data)))
        eq_(result, self.data)


class DateHistoricTest(_DateFixture, fixtures.TablesTest):
    __requires__ = ("date_historic",)
    __backend__ = True
    datatype = Date
    data = datetime.date(1727, 4, 1)

    @testing.requires.date_implicit_bound
    def test_select_direct(self, connection):
        result = connection.scalar(select(literal(self.data)))
        eq_(result, self.data)


class IntegerTest(_LiteralRoundTripFixture, fixtures.TestBase):
    __backend__ = True

    def test_literal(self, literal_round_trip):
        literal_round_trip(Integer, [5], [5])

    def _huge_ints():
        return testing.combinations(
            2147483649,  # 32 bits
            2147483648,  # 32 bits
            2147483647,  # 31 bits
            2147483646,  # 31 bits
            -2147483649,  # 32 bits
            -2147483648,  # 32 interestingly, asyncpg accepts this one as int32
            -2147483647,  # 31
            -2147483646,  # 31
            0,
            1376537018368127,
            -1376537018368127,
            argnames="intvalue",
        )

    @_huge_ints()
    def test_huge_int_auto_accommodation(self, connection, intvalue):
        """test #7909"""

        eq_(
            connection.scalar(
                select(intvalue).where(literal(intvalue) == intvalue)
            ),
            intvalue,
        )

    @_huge_ints()
    def test_huge_int(self, integer_round_trip, intvalue):
        integer_round_trip(BigInteger, intvalue)

    @testing.fixture
    def integer_round_trip(self, metadata, connection):
        def run(datatype, data):
            int_table = Table(
                "integer_table",
                metadata,
                Column(
                    "id",
                    Integer,
                    primary_key=True,
                    test_needs_autoincrement=True,
                ),
                Column("integer_data", datatype),
            )

            metadata.create_all(config.db)

            connection.execute(
                int_table.insert(), {"id": 1, "integer_data": data}
            )

            row = connection.execute(select(int_table.c.integer_data)).first()

            eq_(row, (data,))

            assert isinstance(row[0], int)

        return run


class CastTypeDecoratorTest(_LiteralRoundTripFixture, fixtures.TestBase):
    __backend__ = True

    @testing.fixture
    def string_as_int(self):
        class StringAsInt(TypeDecorator):
            impl = String(50)
            cache_ok = True

            def column_expression(self, col):
                return cast(col, Integer)

            def bind_expression(self, col):
                return cast(type_coerce(col, Integer), String(50))

        return StringAsInt()

    def test_special_type(self, metadata, connection, string_as_int):
        type_ = string_as_int

        t = Table("t", metadata, Column("x", type_))
        t.create(connection)

        connection.execute(t.insert(), [{"x": x} for x in [1, 2, 3]])

        result = {row[0] for row in connection.execute(t.select())}
        eq_(result, {1, 2, 3})

        result = {
            row[0] for row in connection.execute(t.select().where(t.c.x == 2))
        }
        eq_(result, {2})


class TrueDivTest(fixtures.TestBase):
    __backend__ = True

    @testing.combinations(
        ("15", "10", 1.5),
        ("-15", "10", -1.5),
        argnames="left, right, expected",
    )
    def test_truediv_integer(self, connection, left, right, expected):
        """test #4926"""

        eq_(
            connection.scalar(
                select(
                    literal_column(left, type_=Integer())
                    / literal_column(right, type_=Integer())
                )
            ),
            expected,
        )

    @testing.combinations(
        ("15", "10", 1), ("-15", "5", -3), argnames="left, right, expected"
    )
    def test_floordiv_integer(self, connection, left, right, expected):
        """test #4926"""

        eq_(
            connection.scalar(
                select(
                    literal_column(left, type_=Integer())
                    // literal_column(right, type_=Integer())
                )
            ),
            expected,
        )

    @testing.combinations(
        ("5.52", "2.4", "2.3"), argnames="left, right, expected"
    )
    def test_truediv_numeric(self, connection, left, right, expected):
        """test #4926"""

        eq_(
            connection.scalar(
                select(
                    literal_column(left, type_=Numeric(10, 2))
                    / literal_column(right, type_=Numeric(10, 2))
                )
            ),
            decimal.Decimal(expected),
        )

    @testing.combinations(
        ("5.52", "2.4", 2.3), argnames="left, right, expected"
    )
    def test_truediv_float(self, connection, left, right, expected):
        """test #4926"""

        eq_(
            connection.scalar(
                select(
                    literal_column(left, type_=Float())
                    / literal_column(right, type_=Float())
                )
            ),
            expected,
        )

    @testing.combinations(
        ("5.52", "2.4", "2.0"), argnames="left, right, expected"
    )
    def test_floordiv_numeric(self, connection, left, right, expected):
        """test #4926"""

        eq_(
            connection.scalar(
                select(
                    literal_column(left, type_=Numeric())
                    // literal_column(right, type_=Numeric())
                )
            ),
            decimal.Decimal(expected),
        )

    def test_truediv_integer_bound(self, connection):
        """test #4926"""

        eq_(
            connection.scalar(select(literal(15) / literal(10))),
            1.5,
        )

    def test_floordiv_integer_bound(self, connection):
        """test #4926"""

        eq_(
            connection.scalar(select(literal(15) // literal(10))),
            1,
        )


class NumericTest(_LiteralRoundTripFixture, fixtures.TestBase):
    __backend__ = True

    @testing.fixture
    def do_numeric_test(self, metadata, connection):
        def run(type_, input_, output, filter_=None, check_scale=False):
            t = Table("t", metadata, Column("x", type_))
            t.create(connection)
            connection.execute(t.insert(), [{"x": x} for x in input_])

            result = {row[0] for row in connection.execute(t.select())}
            output = set(output)
            if filter_:
                result = {filter_(x) for x in result}
                output = {filter_(x) for x in output}
            eq_(result, output)
            if check_scale:
                eq_([str(x) for x in result], [str(x) for x in output])

            connection.execute(t.delete())

            # test that this is actually a number!
            # note we have tiny scale here as we have tests with very
            # small scale Numeric types.  PostgreSQL will raise an error
            # if you use values outside the available scale.
            if type_.asdecimal:
                test_value = decimal.Decimal("2.9")
                add_value = decimal.Decimal("37.12")
            else:
                test_value = 2.9
                add_value = 37.12

            connection.execute(t.insert(), {"x": test_value})
            assert_we_are_a_number = connection.scalar(
                select(type_coerce(t.c.x + add_value, type_))
            )
            eq_(
                round(assert_we_are_a_number, 3),
                round(test_value + add_value, 3),
            )

        return run

    def test_render_literal_numeric(self, literal_round_trip):
        literal_round_trip(
            Numeric(precision=8, scale=4),
            [15.7563, decimal.Decimal("15.7563")],
            [decimal.Decimal("15.7563")],
        )

    def test_render_literal_numeric_asfloat(self, literal_round_trip):
        literal_round_trip(
            Numeric(precision=8, scale=4, asdecimal=False),
            [15.7563, decimal.Decimal("15.7563")],
            [15.7563],
        )

    def test_render_literal_float(self, literal_round_trip):
        literal_round_trip(
            Float(),
            [15.7563, decimal.Decimal("15.7563")],
            [15.7563],
            filter_=lambda n: n is not None and round(n, 5) or None,
            support_whereclause=False,
        )

    @testing.requires.precision_generic_float_type
    def test_float_custom_scale(self, do_numeric_test):
        do_numeric_test(
            Float(None, decimal_return_scale=7, asdecimal=True),
            [15.7563827, decimal.Decimal("15.7563827")],
            [decimal.Decimal("15.7563827")],
            check_scale=True,
        )

    def test_numeric_as_decimal(self, do_numeric_test):
        do_numeric_test(
            Numeric(precision=8, scale=4),
            [15.7563, decimal.Decimal("15.7563")],
            [decimal.Decimal("15.7563")],
        )

    def test_numeric_as_float(self, do_numeric_test):
        do_numeric_test(
            Numeric(precision=8, scale=4, asdecimal=False),
            [15.7563, decimal.Decimal("15.7563")],
            [15.7563],
        )

    @testing.requires.infinity_floats
    def test_infinity_floats(self, do_numeric_test):
        """test for #977, #7283"""

        do_numeric_test(
            Float(None),
            [float("inf")],
            [float("inf")],
        )

    @testing.requires.fetch_null_from_numeric
    def test_numeric_null_as_decimal(self, do_numeric_test):
        do_numeric_test(Numeric(precision=8, scale=4), [None], [None])

    @testing.requires.fetch_null_from_numeric
    def test_numeric_null_as_float(self, do_numeric_test):
        do_numeric_test(
            Numeric(precision=8, scale=4, asdecimal=False), [None], [None]
        )

    @testing.requires.floats_to_four_decimals
    def test_float_as_decimal(self, do_numeric_test):
        do_numeric_test(
            Float(asdecimal=True),
            [15.756, decimal.Decimal("15.756"), None],
            [decimal.Decimal("15.756"), None],
            filter_=lambda n: n is not None and round(n, 4) or None,
        )

    def test_float_as_float(self, do_numeric_test):
        do_numeric_test(
            Float(),
            [15.756, decimal.Decimal("15.756")],
            [15.756],
            filter_=lambda n: n is not None and round(n, 5) or None,
        )

    @testing.requires.literal_float_coercion
    def test_float_coerce_round_trip(self, connection):
        expr = 15.7563

        val = connection.scalar(select(literal(expr)))
        eq_(val, expr)

    # this does not work in MySQL, see #4036, however we choose not
    # to render CAST unconditionally since this is kind of an edge case.

    @testing.requires.implicit_decimal_binds
    def test_decimal_coerce_round_trip(self, connection):
        expr = decimal.Decimal("15.7563")

        val = connection.scalar(select(literal(expr)))
        eq_(val, expr)

    def test_decimal_coerce_round_trip_w_cast(self, connection):
        expr = decimal.Decimal("15.7563")

        val = connection.scalar(select(cast(expr, Numeric(10, 4))))
        eq_(val, expr)

    @testing.requires.precision_numerics_general
    def test_precision_decimal(self, do_numeric_test):
        numbers = {
            decimal.Decimal("54.234246451650"),
            decimal.Decimal("0.004354"),
            decimal.Decimal("900.0"),
        }

        do_numeric_test(Numeric(precision=18, scale=12), numbers, numbers)

    @testing.requires.precision_numerics_enotation_large
    def test_enotation_decimal(self, do_numeric_test):
        """test exceedingly small decimals.

        Decimal reports values with E notation when the exponent
        is greater than 6.

        """

        numbers = {
            decimal.Decimal("1E-2"),
            decimal.Decimal("1E-3"),
            decimal.Decimal("1E-4"),
            decimal.Decimal("1E-5"),
            decimal.Decimal("1E-6"),
            decimal.Decimal("1E-7"),
            decimal.Decimal("1E-8"),
            decimal.Decimal("0.01000005940696"),
            decimal.Decimal("0.00000005940696"),
            decimal.Decimal("0.00000000000696"),
            decimal.Decimal("0.70000000000696"),
            decimal.Decimal("696E-12"),
        }
        do_numeric_test(Numeric(precision=18, scale=14), numbers, numbers)

    @testing.requires.precision_numerics_enotation_large
    def test_enotation_decimal_large(self, do_numeric_test):
        """test exceedingly large decimals."""

        numbers = {
            decimal.Decimal("4E+8"),
            decimal.Decimal("5748E+15"),
            decimal.Decimal("1.521E+15"),
            decimal.Decimal("00000000000000.1E+12"),
        }
        do_numeric_test(Numeric(precision=25, scale=2), numbers, numbers)

    @testing.requires.precision_numerics_many_significant_digits
    def test_many_significant_digits(self, do_numeric_test):
        numbers = {
            decimal.Decimal("31943874831932418390.01"),
            decimal.Decimal("319438950232418390.273596"),
            decimal.Decimal("87673.594069654243"),
        }
        do_numeric_test(Numeric(precision=38, scale=12), numbers, numbers)

    @testing.requires.precision_numerics_retains_significant_digits
    def test_numeric_no_decimal(self, do_numeric_test):
        numbers = {decimal.Decimal("1.000")}
        do_numeric_test(
            Numeric(precision=5, scale=3), numbers, numbers, check_scale=True
        )

    @testing.combinations(sqltypes.Float, sqltypes.Double, argnames="cls_")
    @testing.requires.float_is_numeric
    def test_float_is_not_numeric(self, connection, cls_):
        target_type = cls_().dialect_impl(connection.dialect)
        numeric_type = sqltypes.Numeric().dialect_impl(connection.dialect)

        ne_(target_type.__visit_name__, numeric_type.__visit_name__)
        ne_(target_type.__class__, numeric_type.__class__)


class BooleanTest(_LiteralRoundTripFixture, fixtures.TablesTest):
    __backend__ = True

    @classmethod
    def define_tables(cls, metadata):
        Table(
            "boolean_table",
            metadata,
            Column("id", Integer, primary_key=True, autoincrement=False),
            Column("value", Boolean),
            Column("unconstrained_value", Boolean(create_constraint=False)),
        )

    def test_render_literal_bool(self, literal_round_trip):
        literal_round_trip(Boolean(), [True, False], [True, False])

    def test_round_trip(self, connection):
        boolean_table = self.tables.boolean_table

        connection.execute(
            boolean_table.insert(),
            {"id": 1, "value": True, "unconstrained_value": False},
        )

        row = connection.execute(
            select(boolean_table.c.value, boolean_table.c.unconstrained_value)
        ).first()

        eq_(row, (True, False))
        assert isinstance(row[0], bool)

    @testing.requires.nullable_booleans
    def test_null(self, connection):
        boolean_table = self.tables.boolean_table

        connection.execute(
            boolean_table.insert(),
            {"id": 1, "value": None, "unconstrained_value": None},
        )

        row = connection.execute(
            select(boolean_table.c.value, boolean_table.c.unconstrained_value)
        ).first()

        eq_(row, (None, None))

    def test_whereclause(self):
        # testing "WHERE <column>" renders a compatible expression
        boolean_table = self.tables.boolean_table

        with config.db.begin() as conn:
            conn.execute(
                boolean_table.insert(),
                [
                    {"id": 1, "value": True, "unconstrained_value": True},
                    {"id": 2, "value": False, "unconstrained_value": False},
                ],
            )

            eq_(
                conn.scalar(
                    select(boolean_table.c.id).where(boolean_table.c.value)
                ),
                1,
            )
            eq_(
                conn.scalar(
                    select(boolean_table.c.id).where(
                        boolean_table.c.unconstrained_value
                    )
                ),
                1,
            )
            eq_(
                conn.scalar(
                    select(boolean_table.c.id).where(~boolean_table.c.value)
                ),
                2,
            )
            eq_(
                conn.scalar(
                    select(boolean_table.c.id).where(
                        ~boolean_table.c.unconstrained_value
                    )
                ),
                2,
            )


class JSONTest(_LiteralRoundTripFixture, fixtures.TablesTest):
    __requires__ = ("json_type",)
    __backend__ = True

    datatype = JSON

    @classmethod
    def define_tables(cls, metadata):
        Table(
            "data_table",
            metadata,
            Column("id", Integer, primary_key=True),
            Column("name", String(30), nullable=False),
            Column("data", cls.datatype, nullable=False),
            Column("nulldata", cls.datatype(none_as_null=True)),
        )

    def test_round_trip_data1(self, connection):
        self._test_round_trip({"key1": "value1", "key2": "value2"}, connection)

    @testing.combinations(
        ("unicode", True), ("ascii", False), argnames="unicode_", id_="ia"
    )
    @testing.combinations(100, 1999, 3000, 4000, 5000, 9000, argnames="length")
    def test_round_trip_pretty_large_data(self, connection, unicode_, length):
        if unicode_:
            data = "réve🐍illé" * ((length // 9) + 1)
            data = data[0 : (length // 2)]
        else:
            data = "abcdefg" * ((length // 7) + 1)
            data = data[0:length]

        self._test_round_trip({"key1": data, "key2": data}, connection)

    def _test_round_trip(self, data_element, connection):
        data_table = self.tables.data_table

        connection.execute(
            data_table.insert(),
            {"id": 1, "name": "row1", "data": data_element},
        )

        row = connection.execute(select(data_table.c.data)).first()

        eq_(row, (data_element,))

    def _index_fixtures(include_comparison):
        if include_comparison:
            # basically SQL Server and MariaDB can kind of do json
            # comparison, MySQL, PG and SQLite can't.  not worth it.
            json_elements = []
        else:
            json_elements = [
                ("json", {"foo": "bar"}),
                ("json", ["one", "two", "three"]),
                (None, {"foo": "bar"}),
                (None, ["one", "two", "three"]),
            ]

        elements = [
            ("boolean", True),
            ("boolean", False),
            ("boolean", None),
            ("string", "some string"),
            ("string", None),
            ("string", "réve illé"),
            (
                "string",
                "réve🐍 illé",
                testing.requires.json_index_supplementary_unicode_element,
            ),
            ("integer", 15),
            ("integer", 1),
            ("integer", 0),
            ("integer", None),
            ("float", 28.5),
            ("float", None),
            ("float", 1234567.89, testing.requires.literal_float_coercion),
            ("numeric", 1234567.89),
            # this one "works" because the float value you see here is
            # lost immediately to floating point stuff
            (
                "numeric",
                99998969694839.983485848,
            ),
            ("numeric", 99939.983485848),
            ("_decimal", decimal.Decimal("1234567.89")),
            (
                "_decimal",
                decimal.Decimal("99998969694839.983485848"),
                # fails on SQLite and MySQL (non-mariadb)
                requirements.cast_precision_numerics_many_significant_digits,
            ),
            (
                "_decimal",
                decimal.Decimal("99939.983485848"),
            ),
        ] + json_elements

        def decorate(fn):
            fn = testing.combinations(id_="sa", *elements)(fn)

            return fn

        return decorate

    def _json_value_insert(self, connection, datatype, value, data_element):
        data_table = self.tables.data_table
        if datatype == "_decimal":
            # Python's builtin json serializer basically doesn't support
            # Decimal objects without implicit float conversion period.
            # users can otherwise use simplejson which supports
            # precision decimals

            # https://bugs.python.org/issue16535

            # inserting as strings to avoid a new fixture around the
            # dialect which would have idiosyncrasies for different
            # backends.

            class DecimalEncoder(json.JSONEncoder):
                def default(self, o):
                    if isinstance(o, decimal.Decimal):
                        return str(o)
                    return super().default(o)

            json_data = json.dumps(data_element, cls=DecimalEncoder)

            # take the quotes out.  yup, there is *literally* no other
            # way to get Python's json.dumps() to put all the digits in
            # the string
            json_data = re.sub(r'"(%s)"' % str(value), str(value), json_data)

            datatype = "numeric"

            connection.execute(
                data_table.insert().values(
                    name="row1",
                    # to pass the string directly to every backend, including
                    # PostgreSQL which needs the value to be CAST as JSON
                    # both in the SQL as well as at the prepared statement
                    # level for asyncpg, while at the same time MySQL
                    # doesn't even support CAST for JSON, here we are
                    # sending the string embedded in the SQL without using
                    # a parameter.
                    data=bindparam(None, json_data, literal_execute=True),
                    nulldata=bindparam(None, json_data, literal_execute=True),
                ),
            )
        else:
            connection.execute(
                data_table.insert(),
                {
                    "name": "row1",
                    "data": data_element,
                    "nulldata": data_element,
                },
            )

        p_s = None

        if datatype:
            if datatype == "numeric":
                a, b = str(value).split(".")
                s = len(b)
                p = len(a) + s

                if isinstance(value, decimal.Decimal):
                    compare_value = value
                else:
                    compare_value = decimal.Decimal(str(value))

                p_s = (p, s)
            else:
                compare_value = value
        else:
            compare_value = value

        return datatype, compare_value, p_s

    @_index_fixtures(False)
    def test_index_typed_access(self, datatype, value):
        data_table = self.tables.data_table
        data_element = {"key1": value}

        with config.db.begin() as conn:
            datatype, compare_value, p_s = self._json_value_insert(
                conn, datatype, value, data_element
            )

            expr = data_table.c.data["key1"]
            if datatype:
                if datatype == "numeric" and p_s:
                    expr = expr.as_numeric(*p_s)
                else:
                    expr = getattr(expr, "as_%s" % datatype)()

            roundtrip = conn.scalar(select(expr))
            eq_(roundtrip, compare_value)
            is_(type(roundtrip), type(compare_value))

    @_index_fixtures(True)
    def test_index_typed_comparison(self, datatype, value):
        data_table = self.tables.data_table
        data_element = {"key1": value}

        with config.db.begin() as conn:
            datatype, compare_value, p_s = self._json_value_insert(
                conn, datatype, value, data_element
            )

            expr = data_table.c.data["key1"]
            if datatype:
                if datatype == "numeric" and p_s:
                    expr = expr.as_numeric(*p_s)
                else:
                    expr = getattr(expr, "as_%s" % datatype)()

            row = conn.execute(
                select(expr).where(expr == compare_value)
            ).first()

            # make sure we get a row even if value is None
            eq_(row, (compare_value,))

    @_index_fixtures(True)
    def test_path_typed_comparison(self, datatype, value):
        data_table = self.tables.data_table
        data_element = {"key1": {"subkey1": value}}
        with config.db.begin() as conn:
            datatype, compare_value, p_s = self._json_value_insert(
                conn, datatype, value, data_element
            )

            expr = data_table.c.data[("key1", "subkey1")]

            if datatype:
                if datatype == "numeric" and p_s:
                    expr = expr.as_numeric(*p_s)
                else:
                    expr = getattr(expr, "as_%s" % datatype)()

            row = conn.execute(
                select(expr).where(expr == compare_value)
            ).first()

            # make sure we get a row even if value is None
            eq_(row, (compare_value,))

    @testing.combinations(
        (True,),
        (False,),
        (None,),
        (15,),
        (0,),
        (-1,),
        (-1.0,),
        (15.052,),
        ("a string",),
        ("réve illé",),
        ("réve🐍 illé",),
    )
    def test_single_element_round_trip(self, element):
        data_table = self.tables.data_table
        data_element = element
        with config.db.begin() as conn:
            conn.execute(
                data_table.insert(),
                {
                    "name": "row1",
                    "data": data_element,
                    "nulldata": data_element,
                },
            )

            row = conn.execute(
                select(data_table.c.data, data_table.c.nulldata)
            ).first()

            eq_(row, (data_element, data_element))

    def test_round_trip_custom_json(self):
        data_table = self.tables.data_table
        data_element = {"key1": "data1"}

        js = mock.Mock(side_effect=json.dumps)
        jd = mock.Mock(side_effect=json.loads)
        engine = engines.testing_engine(
            options=dict(json_serializer=js, json_deserializer=jd)
        )

        # support sqlite :memory: database...
        data_table.create(engine, checkfirst=True)
        with engine.begin() as conn:
            conn.execute(
                data_table.insert(), {"name": "row1", "data": data_element}
            )
            row = conn.execute(select(data_table.c.data)).first()

            eq_(row, (data_element,))
            eq_(js.mock_calls, [mock.call(data_element)])
            if testing.requires.json_deserializer_binary.enabled:
                eq_(
                    jd.mock_calls,
                    [mock.call(json.dumps(data_element).encode())],
                )
            else:
                eq_(jd.mock_calls, [mock.call(json.dumps(data_element))])

    @testing.combinations(
        ("parameters",),
        ("multiparameters",),
        ("values",),
        ("omit",),
        argnames="insert_type",
    )
    def test_round_trip_none_as_sql_null(self, connection, insert_type):
        col = self.tables.data_table.c["nulldata"]

        conn = connection

        if insert_type == "parameters":
            stmt, params = self.tables.data_table.insert(), {
                "name": "r1",
                "nulldata": None,
                "data": None,
            }
        elif insert_type == "multiparameters":
            stmt, params = self.tables.data_table.insert(), [
                {"name": "r1", "nulldata": None, "data": None}
            ]
        elif insert_type == "values":
            stmt, params = (
                self.tables.data_table.insert().values(
                    name="r1",
                    nulldata=None,
                    data=None,
                ),
                {},
            )
        elif insert_type == "omit":
            stmt, params = (
                self.tables.data_table.insert(),
                {"name": "r1", "data": None},
            )

        else:
            assert False

        conn.execute(stmt, params)

        eq_(
            conn.scalar(
                select(self.tables.data_table.c.name).where(col.is_(null()))
            ),
            "r1",
        )

        eq_(conn.scalar(select(col)), None)

    def test_round_trip_json_null_as_json_null(self, connection):
        col = self.tables.data_table.c["data"]

        conn = connection
        conn.execute(
            self.tables.data_table.insert(),
            {"name": "r1", "data": JSON.NULL},
        )

        eq_(
            conn.scalar(
                select(self.tables.data_table.c.name).where(
                    cast(col, String) == "null"
                )
            ),
            "r1",
        )

        eq_(conn.scalar(select(col)), None)

    @testing.combinations(
        ("parameters",),
        ("multiparameters",),
        ("values",),
        argnames="insert_type",
    )
    def test_round_trip_none_as_json_null(self, connection, insert_type):
        col = self.tables.data_table.c["data"]

        if insert_type == "parameters":
            stmt, params = self.tables.data_table.insert(), {
                "name": "r1",
                "data": None,
            }
        elif insert_type == "multiparameters":
            stmt, params = self.tables.data_table.insert(), [
                {"name": "r1", "data": None}
            ]
        elif insert_type == "values":
            stmt, params = (
                self.tables.data_table.insert().values(name="r1", data=None),
                {},
            )
        else:
            assert False

        conn = connection
        conn.execute(stmt, params)

        eq_(
            conn.scalar(
                select(self.tables.data_table.c.name).where(
                    cast(col, String) == "null"
                )
            ),
            "r1",
        )

        eq_(conn.scalar(select(col)), None)

    def test_unicode_round_trip(self):
        # note we include Unicode supplementary characters as well
        with config.db.begin() as conn:
            conn.execute(
                self.tables.data_table.insert(),
                {
                    "name": "r1",
                    "data": {
                        "réve🐍 illé": "réve🐍 illé",
                        "data": {"k1": "drôl🐍e"},
                    },
                },
            )

            eq_(
                conn.scalar(select(self.tables.data_table.c.data)),
                {
                    "réve🐍 illé": "réve🐍 illé",
                    "data": {"k1": "drôl🐍e"},
                },
            )

    def test_eval_none_flag_orm(self, connection):
        Base = declarative_base()

        class Data(Base):
            __table__ = self.tables.data_table

        with Session(connection) as s:
            d1 = Data(name="d1", data=None, nulldata=None)
            s.add(d1)
            s.commit()

            s.bulk_insert_mappings(
                Data, [{"name": "d2", "data": None, "nulldata": None}]
            )
            eq_(
                s.query(
                    cast(self.tables.data_table.c.data, String()),
                    cast(self.tables.data_table.c.nulldata, String),
                )
                .filter(self.tables.data_table.c.name == "d1")
                .first(),
                ("null", None),
            )
            eq_(
                s.query(
                    cast(self.tables.data_table.c.data, String()),
                    cast(self.tables.data_table.c.nulldata, String),
                )
                .filter(self.tables.data_table.c.name == "d2")
                .first(),
                ("null", None),
            )


class JSONLegacyStringCastIndexTest(
    _LiteralRoundTripFixture, fixtures.TablesTest
):
    """test JSON index access with "cast to string", which we have documented
    for a long time as how to compare JSON values, but is ultimately not
    reliable in all cases.   The "as_XYZ()" comparators should be used
    instead.

    """

    __requires__ = ("json_type", "legacy_unconditional_json_extract")
    __backend__ = True

    datatype = JSON

    data1 = {"key1": "value1", "key2": "value2"}

    data2 = {
        "Key 'One'": "value1",
        "key two": "value2",
        "key three": "value ' three '",
    }

    data3 = {
        "key1": [1, 2, 3],
        "key2": ["one", "two", "three"],
        "key3": [{"four": "five"}, {"six": "seven"}],
    }

    data4 = ["one", "two", "three"]

    data5 = {
        "nested": {
            "elem1": [{"a": "b", "c": "d"}, {"e": "f", "g": "h"}],
            "elem2": {"elem3": {"elem4": "elem5"}},
        }
    }

    data6 = {"a": 5, "b": "some value", "c": {"foo": "bar"}}

    @classmethod
    def define_tables(cls, metadata):
        Table(
            "data_table",
            metadata,
            Column("id", Integer, primary_key=True),
            Column("name", String(30), nullable=False),
            Column("data", cls.datatype),
            Column("nulldata", cls.datatype(none_as_null=True)),
        )

    def _criteria_fixture(self):
        with config.db.begin() as conn:
            conn.execute(
                self.tables.data_table.insert(),
                [
                    {"name": "r1", "data": self.data1},
                    {"name": "r2", "data": self.data2},
                    {"name": "r3", "data": self.data3},
                    {"name": "r4", "data": self.data4},
                    {"name": "r5", "data": self.data5},
                    {"name": "r6", "data": self.data6},
                ],
            )

    def _test_index_criteria(self, crit, expected, test_literal=True):
        self._criteria_fixture()
        with config.db.connect() as conn:
            stmt = select(self.tables.data_table.c.name).where(crit)

            eq_(conn.scalar(stmt), expected)

            if test_literal:
                literal_sql = str(
                    stmt.compile(
                        config.db, compile_kwargs={"literal_binds": True}
                    )
                )

                eq_(conn.exec_driver_sql(literal_sql).scalar(), expected)

    def test_string_cast_crit_spaces_in_key(self):
        name = self.tables.data_table.c.name
        col = self.tables.data_table.c["data"]

        # limit the rows here to avoid PG error
        # "cannot extract field from a non-object", which is
        # fixed in 9.4 but may exist in 9.3
        self._test_index_criteria(
            and_(
                name.in_(["r1", "r2", "r3"]),
                cast(col["key two"], String) == '"value2"',
            ),
            "r2",
        )

    @config.requirements.json_array_indexes
    def test_string_cast_crit_simple_int(self):
        name = self.tables.data_table.c.name
        col = self.tables.data_table.c["data"]

        # limit the rows here to avoid PG error
        # "cannot extract array element from a non-array", which is
        # fixed in 9.4 but may exist in 9.3
        self._test_index_criteria(
            and_(
                name == "r4",
                cast(col[1], String) == '"two"',
            ),
            "r4",
        )

    def test_string_cast_crit_mixed_path(self):
        col = self.tables.data_table.c["data"]
        self._test_index_criteria(
            cast(col[("key3", 1, "six")], String) == '"seven"',
            "r3",
        )

    def test_string_cast_crit_string_path(self):
        col = self.tables.data_table.c["data"]
        self._test_index_criteria(
            cast(col[("nested", "elem2", "elem3", "elem4")], String)
            == '"elem5"',
            "r5",
        )

    def test_string_cast_crit_against_string_basic(self):
        name = self.tables.data_table.c.name
        col = self.tables.data_table.c["data"]

        self._test_index_criteria(
            and_(
                name == "r6",
                cast(col["b"], String) == '"some value"',
            ),
            "r6",
        )


class UuidTest(_LiteralRoundTripFixture, fixtures.TablesTest):
    __backend__ = True

    datatype = Uuid

    @classmethod
    def define_tables(cls, metadata):
        Table(
            "uuid_table",
            metadata,
            Column(
                "id", Integer, primary_key=True, test_needs_autoincrement=True
            ),
            Column("uuid_data", cls.datatype),
            Column("uuid_text_data", cls.datatype(as_uuid=False)),
            Column("uuid_data_nonnative", Uuid(native_uuid=False)),
            Column(
                "uuid_text_data_nonnative",
                Uuid(as_uuid=False, native_uuid=False),
            ),
        )

    def test_uuid_round_trip(self, connection):
        data = uuid.uuid4()
        uuid_table = self.tables.uuid_table

        connection.execute(
            uuid_table.insert(),
            {"id": 1, "uuid_data": data, "uuid_data_nonnative": data},
        )
        row = connection.execute(
            select(
                uuid_table.c.uuid_data, uuid_table.c.uuid_data_nonnative
            ).where(
                uuid_table.c.uuid_data == data,
                uuid_table.c.uuid_data_nonnative == data,
            )
        ).first()
        eq_(row, (data, data))

    def test_uuid_text_round_trip(self, connection):
        data = str(uuid.uuid4())
        uuid_table = self.tables.uuid_table

        connection.execute(
            uuid_table.insert(),
            {
                "id": 1,
                "uuid_text_data": data,
                "uuid_text_data_nonnative": data,
            },
        )
        row = connection.execute(
            select(
                uuid_table.c.uuid_text_data,
                uuid_table.c.uuid_text_data_nonnative,
            ).where(
                uuid_table.c.uuid_text_data == data,
                uuid_table.c.uuid_text_data_nonnative == data,
            )
        ).first()
        eq_((row[0].lower(), row[1].lower()), (data, data))

    def test_literal_uuid(self, literal_round_trip):
        data = uuid.uuid4()
        literal_round_trip(self.datatype, [data], [data])

    def test_literal_text(self, literal_round_trip):
        data = str(uuid.uuid4())
        literal_round_trip(
            self.datatype(as_uuid=False),
            [data],
            [data],
            filter_=lambda x: x.lower(),
        )

    def test_literal_nonnative_uuid(self, literal_round_trip):
        data = uuid.uuid4()
        literal_round_trip(Uuid(native_uuid=False), [data], [data])

    def test_literal_nonnative_text(self, literal_round_trip):
        data = str(uuid.uuid4())
        literal_round_trip(
            Uuid(as_uuid=False, native_uuid=False),
            [data],
            [data],
            filter_=lambda x: x.lower(),
        )

    @testing.requires.insert_returning
    def test_uuid_returning(self, connection):
        data = uuid.uuid4()
        str_data = str(data)
        uuid_table = self.tables.uuid_table

        result = connection.execute(
            uuid_table.insert().returning(
                uuid_table.c.uuid_data,
                uuid_table.c.uuid_text_data,
                uuid_table.c.uuid_data_nonnative,
                uuid_table.c.uuid_text_data_nonnative,
            ),
            {
                "id": 1,
                "uuid_data": data,
                "uuid_text_data": str_data,
                "uuid_data_nonnative": data,
                "uuid_text_data_nonnative": str_data,
            },
        )
        row = result.first()

        eq_(row, (data, str_data, data, str_data))


class NativeUUIDTest(UuidTest):
    __requires__ = ("uuid_data_type",)

    datatype = UUID


__all__ = (
    "ArrayTest",
    "BinaryTest",
    "UnicodeVarcharTest",
    "UnicodeTextTest",
    "JSONTest",
    "JSONLegacyStringCastIndexTest",
    "DateTest",
    "DateTimeTest",
    "DateTimeTZTest",
    "TextTest",
    "NumericTest",
    "IntegerTest",
    "IntervalTest",
    "PrecisionIntervalTest",
    "CastTypeDecoratorTest",
    "DateTimeHistoricTest",
    "DateTimeCoercedToDateTimeTest",
    "TimeMicrosecondsTest",
    "TimestampMicrosecondsTest",
    "TimeTest",
    "TimeTZTest",
    "TrueDivTest",
    "DateTimeMicrosecondsTest",
    "DateHistoricTest",
    "StringTest",
    "BooleanTest",
    "UuidTest",
    "NativeUUIDTest",
)
