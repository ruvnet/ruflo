import sqlalchemy as sa
from sqlalchemy import Column
from sqlalchemy import Integer
from sqlalchemy import MetaData
from sqlalchemy import Table

from ._autogen_fixtures import AutogenFixtureTest
from ... import testing
from ...testing import config
from ...testing import eq_
from ...testing import exclusions
from ...testing import is_
from ...testing import is_true
from ...testing import mock
from ...testing import TestBase


class AutogenerateComputedTest(AutogenFixtureTest, TestBase):
    __requires__ = ("computed_columns",)
    __backend__ = True

    def test_add_computed_column(self):
        m1 = MetaData()
        m2 = MetaData()

        Table("user", m1, Column("id", Integer, primary_key=True))

        Table(
            "user",
            m2,
            Column("id", Integer, primary_key=True),
            Column("foo", Integer, sa.Computed("5")),
        )

        diffs = self._fixture(m1, m2)

        eq_(diffs[0][0], "add_column")
        eq_(diffs[0][2], "user")
        eq_(diffs[0][3].name, "foo")
        c = diffs[0][3].computed

        is_true(isinstance(c, sa.Computed))
        is_(c.persisted, None)
        eq_(str(c.sqltext), "5")

    def test_remove_computed_column(self):
        m1 = MetaData()
        m2 = MetaData()

        Table(
            "user",
            m1,
            Column("id", Integer, primary_key=True),
            Column("foo", Integer, sa.Computed("5")),
        )

        Table("user", m2, Column("id", Integer, primary_key=True))

        diffs = self._fixture(m1, m2)

        eq_(diffs[0][0], "remove_column")
        eq_(diffs[0][2], "user")
        c = diffs[0][3]
        eq_(c.name, "foo")

        if config.requirements.computed_reflects_normally.enabled:
            is_true(isinstance(c.computed, sa.Computed))
        else:
            is_(c.computed, None)

        if config.requirements.computed_reflects_as_server_default.enabled:
            is_true(isinstance(c.server_default, sa.DefaultClause))
            eq_(str(c.server_default.arg.text), "5")
        elif config.requirements.computed_reflects_normally.enabled:
            is_true(isinstance(c.computed, sa.Computed))
        else:
            is_(c.computed, None)

    @testing.combinations(
        lambda: (None, sa.Computed("bar*5")),
        (lambda: (sa.Computed("bar*5"), None)),
        lambda: (
            sa.Computed("bar*5"),
            sa.Computed("bar * 42", persisted=True),
        ),
        lambda: (sa.Computed("bar*5"), sa.Computed("bar * 42")),
    )
    @config.requirements.computed_reflects_normally
    def test_cant_change_computed_warning(self, test_case):
        arg_before, arg_after = testing.resolve_lambda(test_case, **locals())
        m1 = MetaData()
        m2 = MetaData()

        arg_before = [] if arg_before is None else [arg_before]
        arg_after = [] if arg_after is None else [arg_after]

        Table(
            "user",
            m1,
            Column("id", Integer, primary_key=True),
            Column("bar", Integer),
            Column("foo", Integer, *arg_before),
        )

        Table(
            "user",
            m2,
            Column("id", Integer, primary_key=True),
            Column("bar", Integer),
            Column("foo", Integer, *arg_after),
        )

        with mock.patch("alembic.util.warn") as mock_warn:
            diffs = self._fixture(m1, m2)

        eq_(
            mock_warn.mock_calls,
            [mock.call("Computed default on user.foo cannot be modified")],
        )

        eq_(list(diffs), [])

    @testing.combinations(
        lambda: (None, None),
        lambda: (sa.Computed("5"), sa.Computed("5")),
        lambda: (sa.Computed("bar*5"), sa.Computed("bar*5")),
        (
            lambda: (sa.Computed("bar*5"), None),
            config.requirements.computed_doesnt_reflect_as_server_default,
        ),
    )
    def test_computed_unchanged(self, test_case):
        arg_before, arg_after = testing.resolve_lambda(test_case, **locals())
        m1 = MetaData()
        m2 = MetaData()

        arg_before = [] if arg_before is None else [arg_before]
        arg_after = [] if arg_after is None else [arg_after]

        Table(
            "user",
            m1,
            Column("id", Integer, primary_key=True),
            Column("bar", Integer),
            Column("foo", Integer, *arg_before),
        )

        Table(
            "user",
            m2,
            Column("id", Integer, primary_key=True),
            Column("bar", Integer),
            Column("foo", Integer, *arg_after),
        )

        with mock.patch("alembic.util.warn") as mock_warn:
            diffs = self._fixture(m1, m2)
        eq_(mock_warn.mock_calls, [])

        eq_(list(diffs), [])

    @config.requirements.computed_reflects_as_server_default
    def test_remove_computed_default_on_computed(self):
        """Asserts the current behavior which is that on PG and Oracle,
        the GENERATED ALWAYS AS is reflected as a server default which we can't
        tell is actually "computed", so these come out as a modification to
        the server default.

        """
        m1 = MetaData()
        m2 = MetaData()

        Table(
            "user",
            m1,
            Column("id", Integer, primary_key=True),
            Column("bar", Integer),
            Column("foo", Integer, sa.Computed("bar + 42")),
        )

        Table(
            "user",
            m2,
            Column("id", Integer, primary_key=True),
            Column("bar", Integer),
            Column("foo", Integer),
        )

        diffs = self._fixture(m1, m2)

        eq_(diffs[0][0][0], "modify_default")
        eq_(diffs[0][0][2], "user")
        eq_(diffs[0][0][3], "foo")
        old = diffs[0][0][-2]
        new = diffs[0][0][-1]

        is_(new, None)
        is_true(isinstance(old, sa.DefaultClause))

        if exclusions.against(config, "postgresql"):
            eq_(str(old.arg.text), "(bar + 42)")
        elif exclusions.against(config, "oracle"):
            eq_(str(old.arg.text), '"BAR"+42')
