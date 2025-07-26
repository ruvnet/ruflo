from sqlalchemy import BigInteger
from sqlalchemy import Column
from sqlalchemy import Integer
from sqlalchemy import MetaData
from sqlalchemy import Table
from sqlalchemy.testing import in_

from ._autogen_fixtures import AutogenFixtureTest
from ... import testing
from ...testing import config
from ...testing import eq_
from ...testing import is_
from ...testing import TestBase


class AlterColumnTest(AutogenFixtureTest, TestBase):
    __backend__ = True

    @testing.combinations((True,), (False,))
    @config.requirements.comments
    def test_all_existings_filled(self, pk):
        m1 = MetaData()
        m2 = MetaData()

        Table("a", m1, Column("x", Integer, primary_key=pk))
        Table("a", m2, Column("x", Integer, comment="x", primary_key=pk))

        alter_col = self._assert_alter_col(m1, m2, pk)
        eq_(alter_col.modify_comment, "x")

    @testing.combinations((True,), (False,))
    @config.requirements.comments
    def test_all_existings_filled_in_notnull(self, pk):
        m1 = MetaData()
        m2 = MetaData()

        Table("a", m1, Column("x", Integer, nullable=False, primary_key=pk))
        Table(
            "a",
            m2,
            Column("x", Integer, nullable=False, comment="x", primary_key=pk),
        )

        self._assert_alter_col(m1, m2, pk, nullable=False)

    @testing.combinations((True,), (False,))
    @config.requirements.comments
    def test_all_existings_filled_in_comment(self, pk):
        m1 = MetaData()
        m2 = MetaData()

        Table("a", m1, Column("x", Integer, comment="old", primary_key=pk))
        Table("a", m2, Column("x", Integer, comment="new", primary_key=pk))

        alter_col = self._assert_alter_col(m1, m2, pk)
        eq_(alter_col.existing_comment, "old")

    @testing.combinations((True,), (False,))
    @config.requirements.comments
    def test_all_existings_filled_in_server_default(self, pk):
        m1 = MetaData()
        m2 = MetaData()

        Table(
            "a", m1, Column("x", Integer, server_default="5", primary_key=pk)
        )
        Table(
            "a",
            m2,
            Column(
                "x", Integer, server_default="5", comment="new", primary_key=pk
            ),
        )

        alter_col = self._assert_alter_col(m1, m2, pk)
        in_("5", alter_col.existing_server_default.arg.text)

    def _assert_alter_col(self, m1, m2, pk, nullable=None):
        ops = self._fixture(m1, m2, return_ops=True)
        modify_table = ops.ops[-1]
        alter_col = modify_table.ops[0]

        if nullable is None:
            eq_(alter_col.existing_nullable, not pk)
        else:
            eq_(alter_col.existing_nullable, nullable)
        assert alter_col.existing_type._compare_type_affinity(Integer())
        return alter_col


class AutoincrementTest(AutogenFixtureTest, TestBase):
    __backend__ = True
    __requires__ = ("integer_subtype_comparisons",)

    def test_alter_column_autoincrement_none(self):
        m1 = MetaData()
        m2 = MetaData()

        Table("a", m1, Column("x", Integer, nullable=False))
        Table("a", m2, Column("x", Integer, nullable=True))

        ops = self._fixture(m1, m2, return_ops=True)
        assert "autoincrement" not in ops.ops[0].ops[0].kw

    def test_alter_column_autoincrement_pk_false(self):
        m1 = MetaData()
        m2 = MetaData()

        Table(
            "a",
            m1,
            Column("x", Integer, primary_key=True, autoincrement=False),
        )
        Table(
            "a",
            m2,
            Column("x", BigInteger, primary_key=True, autoincrement=False),
        )

        ops = self._fixture(m1, m2, return_ops=True)
        is_(ops.ops[0].ops[0].kw["autoincrement"], False)

    def test_alter_column_autoincrement_pk_implicit_true(self):
        m1 = MetaData()
        m2 = MetaData()

        Table("a", m1, Column("x", Integer, primary_key=True))
        Table("a", m2, Column("x", BigInteger, primary_key=True))

        ops = self._fixture(m1, m2, return_ops=True)
        is_(ops.ops[0].ops[0].kw["autoincrement"], True)

    def test_alter_column_autoincrement_pk_explicit_true(self):
        m1 = MetaData()
        m2 = MetaData()

        Table(
            "a", m1, Column("x", Integer, primary_key=True, autoincrement=True)
        )
        Table(
            "a",
            m2,
            Column("x", BigInteger, primary_key=True, autoincrement=True),
        )

        ops = self._fixture(m1, m2, return_ops=True)
        is_(ops.ops[0].ops[0].kw["autoincrement"], True)

    def test_alter_column_autoincrement_nonpk_false(self):
        m1 = MetaData()
        m2 = MetaData()

        Table(
            "a",
            m1,
            Column("id", Integer, primary_key=True),
            Column("x", Integer, autoincrement=False),
        )
        Table(
            "a",
            m2,
            Column("id", Integer, primary_key=True),
            Column("x", BigInteger, autoincrement=False),
        )

        ops = self._fixture(m1, m2, return_ops=True)
        is_(ops.ops[0].ops[0].kw["autoincrement"], False)

    def test_alter_column_autoincrement_nonpk_implicit_false(self):
        m1 = MetaData()
        m2 = MetaData()

        Table(
            "a",
            m1,
            Column("id", Integer, primary_key=True),
            Column("x", Integer),
        )
        Table(
            "a",
            m2,
            Column("id", Integer, primary_key=True),
            Column("x", BigInteger),
        )

        ops = self._fixture(m1, m2, return_ops=True)
        assert "autoincrement" not in ops.ops[0].ops[0].kw

    def test_alter_column_autoincrement_nonpk_explicit_true(self):
        m1 = MetaData()
        m2 = MetaData()

        Table(
            "a",
            m1,
            Column("id", Integer, primary_key=True, autoincrement=False),
            Column("x", Integer, autoincrement=True),
        )
        Table(
            "a",
            m2,
            Column("id", Integer, primary_key=True, autoincrement=False),
            Column("x", BigInteger, autoincrement=True),
        )

        ops = self._fixture(m1, m2, return_ops=True)
        is_(ops.ops[0].ops[0].kw["autoincrement"], True)

    def test_alter_column_autoincrement_compositepk_false(self):
        m1 = MetaData()
        m2 = MetaData()

        Table(
            "a",
            m1,
            Column("id", Integer, primary_key=True),
            Column("x", Integer, primary_key=True, autoincrement=False),
        )
        Table(
            "a",
            m2,
            Column("id", Integer, primary_key=True),
            Column("x", BigInteger, primary_key=True, autoincrement=False),
        )

        ops = self._fixture(m1, m2, return_ops=True)
        is_(ops.ops[0].ops[0].kw["autoincrement"], False)

    def test_alter_column_autoincrement_compositepk_implicit_false(self):
        m1 = MetaData()
        m2 = MetaData()

        Table(
            "a",
            m1,
            Column("id", Integer, primary_key=True),
            Column("x", Integer, primary_key=True),
        )
        Table(
            "a",
            m2,
            Column("id", Integer, primary_key=True),
            Column("x", BigInteger, primary_key=True),
        )

        ops = self._fixture(m1, m2, return_ops=True)
        assert "autoincrement" not in ops.ops[0].ops[0].kw

    @config.requirements.autoincrement_on_composite_pk
    def test_alter_column_autoincrement_compositepk_explicit_true(self):
        m1 = MetaData()
        m2 = MetaData()

        Table(
            "a",
            m1,
            Column("id", Integer, primary_key=True, autoincrement=False),
            Column("x", Integer, primary_key=True, autoincrement=True),
            # on SQLA 1.0 and earlier, this being present
            # trips the "add KEY for the primary key" so that the
            # AUTO_INCREMENT keyword is accepted by MySQL.  SQLA 1.1 and
            # greater the columns are just reorganized.
            mysql_engine="InnoDB",
        )
        Table(
            "a",
            m2,
            Column("id", Integer, primary_key=True, autoincrement=False),
            Column("x", BigInteger, primary_key=True, autoincrement=True),
        )

        ops = self._fixture(m1, m2, return_ops=True)
        is_(ops.ops[0].ops[0].kw["autoincrement"], True)
