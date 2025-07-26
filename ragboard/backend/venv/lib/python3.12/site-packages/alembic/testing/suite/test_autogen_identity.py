import sqlalchemy as sa
from sqlalchemy import Column
from sqlalchemy import Integer
from sqlalchemy import MetaData
from sqlalchemy import Table

from alembic.util import sqla_compat
from ._autogen_fixtures import AutogenFixtureTest
from ... import testing
from ...testing import config
from ...testing import eq_
from ...testing import is_true
from ...testing import TestBase


class AutogenerateIdentityTest(AutogenFixtureTest, TestBase):
    __requires__ = ("identity_columns",)
    __backend__ = True

    def test_add_identity_column(self):
        m1 = MetaData()
        m2 = MetaData()

        Table("user", m1, Column("other", sa.Text))

        Table(
            "user",
            m2,
            Column("other", sa.Text),
            Column(
                "id",
                Integer,
                sa.Identity(start=5, increment=7),
                primary_key=True,
            ),
        )

        diffs = self._fixture(m1, m2)

        eq_(diffs[0][0], "add_column")
        eq_(diffs[0][2], "user")
        eq_(diffs[0][3].name, "id")
        i = diffs[0][3].identity

        is_true(isinstance(i, sa.Identity))
        eq_(i.start, 5)
        eq_(i.increment, 7)

    def test_remove_identity_column(self):
        m1 = MetaData()
        m2 = MetaData()

        Table(
            "user",
            m1,
            Column(
                "id",
                Integer,
                sa.Identity(start=2, increment=3),
                primary_key=True,
            ),
        )

        Table("user", m2)

        diffs = self._fixture(m1, m2)

        eq_(diffs[0][0], "remove_column")
        eq_(diffs[0][2], "user")
        c = diffs[0][3]
        eq_(c.name, "id")

        is_true(isinstance(c.identity, sa.Identity))
        eq_(c.identity.start, 2)
        eq_(c.identity.increment, 3)

    def test_no_change_identity_column(self):
        m1 = MetaData()
        m2 = MetaData()

        for m in (m1, m2):
            id_ = sa.Identity(start=2)
            Table("user", m, Column("id", Integer, id_))

        diffs = self._fixture(m1, m2)

        eq_(diffs, [])

    def test_dialect_kwargs_changes(self):
        m1 = MetaData()
        m2 = MetaData()

        if sqla_compat.identity_has_dialect_kwargs:
            args = {"oracle_on_null": True, "oracle_order": True}
        else:
            args = {"on_null": True, "order": True}

        Table("user", m1, Column("id", Integer, sa.Identity(start=2)))
        id_ = sa.Identity(start=2, **args)
        Table("user", m2, Column("id", Integer, id_))

        diffs = self._fixture(m1, m2)
        if config.db.name == "oracle":
            is_true(len(diffs), 1)
            eq_(diffs[0][0][0], "modify_default")
        else:
            eq_(diffs, [])

    @testing.combinations(
        (None, dict(start=2)),
        (dict(start=2), None),
        (dict(start=2), dict(start=2, increment=7)),
        (dict(always=False), dict(always=True)),
        (
            dict(start=1, minvalue=0, maxvalue=100, cycle=True),
            dict(start=1, minvalue=0, maxvalue=100, cycle=False),
        ),
        (
            dict(start=10, increment=3, maxvalue=9999),
            dict(start=10, increment=1, maxvalue=3333),
        ),
    )
    @config.requirements.identity_columns_alter
    def test_change_identity(self, before, after):
        arg_before = (sa.Identity(**before),) if before else ()
        arg_after = (sa.Identity(**after),) if after else ()

        m1 = MetaData()
        m2 = MetaData()

        Table(
            "user",
            m1,
            Column("id", Integer, *arg_before),
            Column("other", sa.Text),
        )

        Table(
            "user",
            m2,
            Column("id", Integer, *arg_after),
            Column("other", sa.Text),
        )

        diffs = self._fixture(m1, m2)

        eq_(len(diffs[0]), 1)
        diffs = diffs[0][0]
        eq_(diffs[0], "modify_default")
        eq_(diffs[2], "user")
        eq_(diffs[3], "id")
        old = diffs[5]
        new = diffs[6]

        def check(kw, idt):
            if kw:
                is_true(isinstance(idt, sa.Identity))
                for k, v in kw.items():
                    eq_(getattr(idt, k), v)
            else:
                is_true(idt in (None, False))

        check(before, old)
        check(after, new)

    def test_add_identity_to_column(self):
        m1 = MetaData()
        m2 = MetaData()

        Table(
            "user",
            m1,
            Column("id", Integer),
            Column("other", sa.Text),
        )

        Table(
            "user",
            m2,
            Column("id", Integer, sa.Identity(start=2, maxvalue=1000)),
            Column("other", sa.Text),
        )

        diffs = self._fixture(m1, m2)

        eq_(len(diffs[0]), 1)
        diffs = diffs[0][0]
        eq_(diffs[0], "modify_default")
        eq_(diffs[2], "user")
        eq_(diffs[3], "id")
        eq_(diffs[5], None)
        added = diffs[6]

        is_true(isinstance(added, sa.Identity))
        eq_(added.start, 2)
        eq_(added.maxvalue, 1000)

    def test_remove_identity_from_column(self):
        m1 = MetaData()
        m2 = MetaData()

        Table(
            "user",
            m1,
            Column("id", Integer, sa.Identity(start=2, maxvalue=1000)),
            Column("other", sa.Text),
        )

        Table(
            "user",
            m2,
            Column("id", Integer),
            Column("other", sa.Text),
        )

        diffs = self._fixture(m1, m2)

        eq_(len(diffs[0]), 1)
        diffs = diffs[0][0]
        eq_(diffs[0], "modify_default")
        eq_(diffs[2], "user")
        eq_(diffs[3], "id")
        eq_(diffs[6], None)
        removed = diffs[5]

        is_true(isinstance(removed, sa.Identity))
