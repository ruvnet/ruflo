from sqlalchemy import Column
from sqlalchemy import Float
from sqlalchemy import MetaData
from sqlalchemy import String
from sqlalchemy import Table

from ._autogen_fixtures import AutogenFixtureTest
from ...testing import eq_
from ...testing import mock
from ...testing import TestBase


class AutogenerateCommentsTest(AutogenFixtureTest, TestBase):
    __backend__ = True

    __requires__ = ("comments",)

    def test_existing_table_comment_no_change(self):
        m1 = MetaData()
        m2 = MetaData()

        Table(
            "some_table",
            m1,
            Column("test", String(10), primary_key=True),
            comment="this is some table",
        )

        Table(
            "some_table",
            m2,
            Column("test", String(10), primary_key=True),
            comment="this is some table",
        )

        diffs = self._fixture(m1, m2)

        eq_(diffs, [])

    def test_add_table_comment(self):
        m1 = MetaData()
        m2 = MetaData()

        Table("some_table", m1, Column("test", String(10), primary_key=True))

        Table(
            "some_table",
            m2,
            Column("test", String(10), primary_key=True),
            comment="this is some table",
        )

        diffs = self._fixture(m1, m2)

        eq_(diffs[0][0], "add_table_comment")
        eq_(diffs[0][1].comment, "this is some table")
        eq_(diffs[0][2], None)

    def test_remove_table_comment(self):
        m1 = MetaData()
        m2 = MetaData()

        Table(
            "some_table",
            m1,
            Column("test", String(10), primary_key=True),
            comment="this is some table",
        )

        Table("some_table", m2, Column("test", String(10), primary_key=True))

        diffs = self._fixture(m1, m2)

        eq_(diffs[0][0], "remove_table_comment")
        eq_(diffs[0][1].comment, None)

    def test_alter_table_comment(self):
        m1 = MetaData()
        m2 = MetaData()

        Table(
            "some_table",
            m1,
            Column("test", String(10), primary_key=True),
            comment="this is some table",
        )

        Table(
            "some_table",
            m2,
            Column("test", String(10), primary_key=True),
            comment="this is also some table",
        )

        diffs = self._fixture(m1, m2)

        eq_(diffs[0][0], "add_table_comment")
        eq_(diffs[0][1].comment, "this is also some table")
        eq_(diffs[0][2], "this is some table")

    def test_existing_column_comment_no_change(self):
        m1 = MetaData()
        m2 = MetaData()

        Table(
            "some_table",
            m1,
            Column("test", String(10), primary_key=True),
            Column("amount", Float, comment="the amount"),
        )

        Table(
            "some_table",
            m2,
            Column("test", String(10), primary_key=True),
            Column("amount", Float, comment="the amount"),
        )

        diffs = self._fixture(m1, m2)

        eq_(diffs, [])

    def test_add_column_comment(self):
        m1 = MetaData()
        m2 = MetaData()

        Table(
            "some_table",
            m1,
            Column("test", String(10), primary_key=True),
            Column("amount", Float),
        )

        Table(
            "some_table",
            m2,
            Column("test", String(10), primary_key=True),
            Column("amount", Float, comment="the amount"),
        )

        diffs = self._fixture(m1, m2)
        eq_(
            diffs,
            [
                [
                    (
                        "modify_comment",
                        None,
                        "some_table",
                        "amount",
                        {
                            "existing_nullable": True,
                            "existing_type": mock.ANY,
                            "existing_server_default": False,
                        },
                        None,
                        "the amount",
                    )
                ]
            ],
        )

    def test_remove_column_comment(self):
        m1 = MetaData()
        m2 = MetaData()

        Table(
            "some_table",
            m1,
            Column("test", String(10), primary_key=True),
            Column("amount", Float, comment="the amount"),
        )

        Table(
            "some_table",
            m2,
            Column("test", String(10), primary_key=True),
            Column("amount", Float),
        )

        diffs = self._fixture(m1, m2)
        eq_(
            diffs,
            [
                [
                    (
                        "modify_comment",
                        None,
                        "some_table",
                        "amount",
                        {
                            "existing_nullable": True,
                            "existing_type": mock.ANY,
                            "existing_server_default": False,
                        },
                        "the amount",
                        None,
                    )
                ]
            ],
        )

    def test_alter_column_comment(self):
        m1 = MetaData()
        m2 = MetaData()

        Table(
            "some_table",
            m1,
            Column("test", String(10), primary_key=True),
            Column("amount", Float, comment="the amount"),
        )

        Table(
            "some_table",
            m2,
            Column("test", String(10), primary_key=True),
            Column("amount", Float, comment="the adjusted amount"),
        )

        diffs = self._fixture(m1, m2)

        eq_(
            diffs,
            [
                [
                    (
                        "modify_comment",
                        None,
                        "some_table",
                        "amount",
                        {
                            "existing_nullable": True,
                            "existing_type": mock.ANY,
                            "existing_server_default": False,
                        },
                        "the amount",
                        "the adjusted amount",
                    )
                ]
            ],
        )
