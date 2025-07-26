from sqlalchemy import Column
from sqlalchemy import ForeignKeyConstraint
from sqlalchemy import Integer
from sqlalchemy import MetaData
from sqlalchemy import String
from sqlalchemy import Table

from ._autogen_fixtures import AutogenFixtureTest
from ...testing import combinations
from ...testing import config
from ...testing import eq_
from ...testing import mock
from ...testing import TestBase


class AutogenerateForeignKeysTest(AutogenFixtureTest, TestBase):
    __backend__ = True
    __requires__ = ("foreign_key_constraint_reflection",)

    def test_remove_fk(self):
        m1 = MetaData()
        m2 = MetaData()

        Table(
            "some_table",
            m1,
            Column("test", String(10), primary_key=True),
        )

        Table(
            "user",
            m1,
            Column("id", Integer, primary_key=True),
            Column("name", String(50), nullable=False),
            Column("a1", String(10), server_default="x"),
            Column("test2", String(10)),
            ForeignKeyConstraint(["test2"], ["some_table.test"]),
        )

        Table(
            "some_table",
            m2,
            Column("test", String(10), primary_key=True),
        )

        Table(
            "user",
            m2,
            Column("id", Integer, primary_key=True),
            Column("name", String(50), nullable=False),
            Column("a1", String(10), server_default="x"),
            Column("test2", String(10)),
        )

        diffs = self._fixture(m1, m2)

        self._assert_fk_diff(
            diffs[0],
            "remove_fk",
            "user",
            ["test2"],
            "some_table",
            ["test"],
            conditional_name="servergenerated",
        )

    def test_add_fk(self):
        m1 = MetaData()
        m2 = MetaData()

        Table(
            "some_table",
            m1,
            Column("id", Integer, primary_key=True),
            Column("test", String(10)),
        )

        Table(
            "user",
            m1,
            Column("id", Integer, primary_key=True),
            Column("name", String(50), nullable=False),
            Column("a1", String(10), server_default="x"),
            Column("test2", String(10)),
        )

        Table(
            "some_table",
            m2,
            Column("id", Integer, primary_key=True),
            Column("test", String(10)),
        )

        Table(
            "user",
            m2,
            Column("id", Integer, primary_key=True),
            Column("name", String(50), nullable=False),
            Column("a1", String(10), server_default="x"),
            Column("test2", String(10)),
            ForeignKeyConstraint(["test2"], ["some_table.test"]),
        )

        diffs = self._fixture(m1, m2)

        self._assert_fk_diff(
            diffs[0], "add_fk", "user", ["test2"], "some_table", ["test"]
        )

    def test_no_change(self):
        m1 = MetaData()
        m2 = MetaData()

        Table(
            "some_table",
            m1,
            Column("id", Integer, primary_key=True),
            Column("test", String(10)),
        )

        Table(
            "user",
            m1,
            Column("id", Integer, primary_key=True),
            Column("name", String(50), nullable=False),
            Column("a1", String(10), server_default="x"),
            Column("test2", Integer),
            ForeignKeyConstraint(["test2"], ["some_table.id"]),
        )

        Table(
            "some_table",
            m2,
            Column("id", Integer, primary_key=True),
            Column("test", String(10)),
        )

        Table(
            "user",
            m2,
            Column("id", Integer, primary_key=True),
            Column("name", String(50), nullable=False),
            Column("a1", String(10), server_default="x"),
            Column("test2", Integer),
            ForeignKeyConstraint(["test2"], ["some_table.id"]),
        )

        diffs = self._fixture(m1, m2)

        eq_(diffs, [])

    def test_no_change_composite_fk(self):
        m1 = MetaData()
        m2 = MetaData()

        Table(
            "some_table",
            m1,
            Column("id_1", String(10), primary_key=True),
            Column("id_2", String(10), primary_key=True),
        )

        Table(
            "user",
            m1,
            Column("id", Integer, primary_key=True),
            Column("name", String(50), nullable=False),
            Column("a1", String(10), server_default="x"),
            Column("other_id_1", String(10)),
            Column("other_id_2", String(10)),
            ForeignKeyConstraint(
                ["other_id_1", "other_id_2"],
                ["some_table.id_1", "some_table.id_2"],
            ),
        )

        Table(
            "some_table",
            m2,
            Column("id_1", String(10), primary_key=True),
            Column("id_2", String(10), primary_key=True),
        )

        Table(
            "user",
            m2,
            Column("id", Integer, primary_key=True),
            Column("name", String(50), nullable=False),
            Column("a1", String(10), server_default="x"),
            Column("other_id_1", String(10)),
            Column("other_id_2", String(10)),
            ForeignKeyConstraint(
                ["other_id_1", "other_id_2"],
                ["some_table.id_1", "some_table.id_2"],
            ),
        )

        diffs = self._fixture(m1, m2)

        eq_(diffs, [])

    def test_casing_convention_changed_so_put_drops_first(self):
        m1 = MetaData()
        m2 = MetaData()

        Table(
            "some_table",
            m1,
            Column("test", String(10), primary_key=True),
        )

        Table(
            "user",
            m1,
            Column("id", Integer, primary_key=True),
            Column("name", String(50), nullable=False),
            Column("a1", String(10), server_default="x"),
            Column("test2", String(10)),
            ForeignKeyConstraint(["test2"], ["some_table.test"], name="MyFK"),
        )

        Table(
            "some_table",
            m2,
            Column("test", String(10), primary_key=True),
        )

        # foreign key autogen currently does not take "name" into account,
        # so change the def just for the purposes of testing the
        # add/drop order for now.
        Table(
            "user",
            m2,
            Column("id", Integer, primary_key=True),
            Column("name", String(50), nullable=False),
            Column("a1", String(10), server_default="x"),
            Column("test2", String(10)),
            ForeignKeyConstraint(["a1"], ["some_table.test"], name="myfk"),
        )

        diffs = self._fixture(m1, m2)

        self._assert_fk_diff(
            diffs[0],
            "remove_fk",
            "user",
            ["test2"],
            "some_table",
            ["test"],
            name="MyFK" if config.requirements.fk_names.enabled else None,
        )

        self._assert_fk_diff(
            diffs[1],
            "add_fk",
            "user",
            ["a1"],
            "some_table",
            ["test"],
            name="myfk",
        )

    def test_add_composite_fk_with_name(self):
        m1 = MetaData()
        m2 = MetaData()

        Table(
            "some_table",
            m1,
            Column("id_1", String(10), primary_key=True),
            Column("id_2", String(10), primary_key=True),
        )

        Table(
            "user",
            m1,
            Column("id", Integer, primary_key=True),
            Column("name", String(50), nullable=False),
            Column("a1", String(10), server_default="x"),
            Column("other_id_1", String(10)),
            Column("other_id_2", String(10)),
        )

        Table(
            "some_table",
            m2,
            Column("id_1", String(10), primary_key=True),
            Column("id_2", String(10), primary_key=True),
        )

        Table(
            "user",
            m2,
            Column("id", Integer, primary_key=True),
            Column("name", String(50), nullable=False),
            Column("a1", String(10), server_default="x"),
            Column("other_id_1", String(10)),
            Column("other_id_2", String(10)),
            ForeignKeyConstraint(
                ["other_id_1", "other_id_2"],
                ["some_table.id_1", "some_table.id_2"],
                name="fk_test_name",
            ),
        )

        diffs = self._fixture(m1, m2)
        self._assert_fk_diff(
            diffs[0],
            "add_fk",
            "user",
            ["other_id_1", "other_id_2"],
            "some_table",
            ["id_1", "id_2"],
            name="fk_test_name",
        )

    @config.requirements.no_name_normalize
    def test_remove_composite_fk(self):
        m1 = MetaData()
        m2 = MetaData()

        Table(
            "some_table",
            m1,
            Column("id_1", String(10), primary_key=True),
            Column("id_2", String(10), primary_key=True),
        )

        Table(
            "user",
            m1,
            Column("id", Integer, primary_key=True),
            Column("name", String(50), nullable=False),
            Column("a1", String(10), server_default="x"),
            Column("other_id_1", String(10)),
            Column("other_id_2", String(10)),
            ForeignKeyConstraint(
                ["other_id_1", "other_id_2"],
                ["some_table.id_1", "some_table.id_2"],
                name="fk_test_name",
            ),
        )

        Table(
            "some_table",
            m2,
            Column("id_1", String(10), primary_key=True),
            Column("id_2", String(10), primary_key=True),
        )

        Table(
            "user",
            m2,
            Column("id", Integer, primary_key=True),
            Column("name", String(50), nullable=False),
            Column("a1", String(10), server_default="x"),
            Column("other_id_1", String(10)),
            Column("other_id_2", String(10)),
        )

        diffs = self._fixture(m1, m2)

        self._assert_fk_diff(
            diffs[0],
            "remove_fk",
            "user",
            ["other_id_1", "other_id_2"],
            "some_table",
            ["id_1", "id_2"],
            conditional_name="fk_test_name",
        )

    def test_add_fk_colkeys(self):
        m1 = MetaData()
        m2 = MetaData()

        Table(
            "some_table",
            m1,
            Column("id_1", String(10), primary_key=True),
            Column("id_2", String(10), primary_key=True),
        )

        Table(
            "user",
            m1,
            Column("id", Integer, primary_key=True),
            Column("other_id_1", String(10)),
            Column("other_id_2", String(10)),
        )

        Table(
            "some_table",
            m2,
            Column("id_1", String(10), key="tid1", primary_key=True),
            Column("id_2", String(10), key="tid2", primary_key=True),
        )

        Table(
            "user",
            m2,
            Column("id", Integer, primary_key=True),
            Column("other_id_1", String(10), key="oid1"),
            Column("other_id_2", String(10), key="oid2"),
            ForeignKeyConstraint(
                ["oid1", "oid2"],
                ["some_table.tid1", "some_table.tid2"],
                name="fk_test_name",
            ),
        )

        diffs = self._fixture(m1, m2)

        self._assert_fk_diff(
            diffs[0],
            "add_fk",
            "user",
            ["other_id_1", "other_id_2"],
            "some_table",
            ["id_1", "id_2"],
            name="fk_test_name",
        )

    def test_no_change_colkeys(self):
        m1 = MetaData()
        m2 = MetaData()

        Table(
            "some_table",
            m1,
            Column("id_1", String(10), primary_key=True),
            Column("id_2", String(10), primary_key=True),
        )

        Table(
            "user",
            m1,
            Column("id", Integer, primary_key=True),
            Column("other_id_1", String(10)),
            Column("other_id_2", String(10)),
            ForeignKeyConstraint(
                ["other_id_1", "other_id_2"],
                ["some_table.id_1", "some_table.id_2"],
            ),
        )

        Table(
            "some_table",
            m2,
            Column("id_1", String(10), key="tid1", primary_key=True),
            Column("id_2", String(10), key="tid2", primary_key=True),
        )

        Table(
            "user",
            m2,
            Column("id", Integer, primary_key=True),
            Column("other_id_1", String(10), key="oid1"),
            Column("other_id_2", String(10), key="oid2"),
            ForeignKeyConstraint(
                ["oid1", "oid2"], ["some_table.tid1", "some_table.tid2"]
            ),
        )

        diffs = self._fixture(m1, m2)

        eq_(diffs, [])


class IncludeHooksTest(AutogenFixtureTest, TestBase):
    __backend__ = True
    __requires__ = ("fk_names",)

    @combinations(("object",), ("name",))
    @config.requirements.no_name_normalize
    def test_remove_connection_fk(self, hook_type):
        m1 = MetaData()
        m2 = MetaData()

        ref = Table(
            "ref",
            m1,
            Column("id", Integer, primary_key=True),
        )
        t1 = Table(
            "t",
            m1,
            Column("x", Integer),
            Column("y", Integer),
        )
        t1.append_constraint(
            ForeignKeyConstraint([t1.c.x], [ref.c.id], name="fk1")
        )
        t1.append_constraint(
            ForeignKeyConstraint([t1.c.y], [ref.c.id], name="fk2")
        )

        ref = Table(
            "ref",
            m2,
            Column("id", Integer, primary_key=True),
        )
        Table(
            "t",
            m2,
            Column("x", Integer),
            Column("y", Integer),
        )

        if hook_type == "object":

            def include_object(object_, name, type_, reflected, compare_to):
                return not (
                    isinstance(object_, ForeignKeyConstraint)
                    and type_ == "foreign_key_constraint"
                    and reflected
                    and name == "fk1"
                )

            diffs = self._fixture(m1, m2, object_filters=include_object)
        elif hook_type == "name":

            def include_name(name, type_, parent_names):
                if name == "fk1":
                    if type_ == "index":  # MariaDB thing
                        return True
                    eq_(type_, "foreign_key_constraint")
                    eq_(
                        parent_names,
                        {
                            "schema_name": None,
                            "table_name": "t",
                            "schema_qualified_table_name": "t",
                        },
                    )
                    return False
                else:
                    return True

            diffs = self._fixture(m1, m2, name_filters=include_name)

        self._assert_fk_diff(
            diffs[0],
            "remove_fk",
            "t",
            ["y"],
            "ref",
            ["id"],
            conditional_name="fk2",
        )
        eq_(len(diffs), 1)

    def test_add_metadata_fk(self):
        m1 = MetaData()
        m2 = MetaData()

        Table(
            "ref",
            m1,
            Column("id", Integer, primary_key=True),
        )
        Table(
            "t",
            m1,
            Column("x", Integer),
            Column("y", Integer),
        )

        ref = Table(
            "ref",
            m2,
            Column("id", Integer, primary_key=True),
        )
        t2 = Table(
            "t",
            m2,
            Column("x", Integer),
            Column("y", Integer),
        )
        t2.append_constraint(
            ForeignKeyConstraint([t2.c.x], [ref.c.id], name="fk1")
        )
        t2.append_constraint(
            ForeignKeyConstraint([t2.c.y], [ref.c.id], name="fk2")
        )

        def include_object(object_, name, type_, reflected, compare_to):
            return not (
                isinstance(object_, ForeignKeyConstraint)
                and type_ == "foreign_key_constraint"
                and not reflected
                and name == "fk1"
            )

        diffs = self._fixture(m1, m2, object_filters=include_object)

        self._assert_fk_diff(
            diffs[0], "add_fk", "t", ["y"], "ref", ["id"], name="fk2"
        )
        eq_(len(diffs), 1)

    @combinations(("object",), ("name",))
    @config.requirements.no_name_normalize
    def test_change_fk(self, hook_type):
        m1 = MetaData()
        m2 = MetaData()

        r1a = Table(
            "ref_a",
            m1,
            Column("a", Integer, primary_key=True),
        )
        Table(
            "ref_b",
            m1,
            Column("a", Integer, primary_key=True),
            Column("b", Integer, primary_key=True),
        )
        t1 = Table(
            "t",
            m1,
            Column("x", Integer),
            Column("y", Integer),
            Column("z", Integer),
        )
        t1.append_constraint(
            ForeignKeyConstraint([t1.c.x], [r1a.c.a], name="fk1")
        )
        t1.append_constraint(
            ForeignKeyConstraint([t1.c.y], [r1a.c.a], name="fk2")
        )

        Table(
            "ref_a",
            m2,
            Column("a", Integer, primary_key=True),
        )
        r2b = Table(
            "ref_b",
            m2,
            Column("a", Integer, primary_key=True),
            Column("b", Integer, primary_key=True),
        )
        t2 = Table(
            "t",
            m2,
            Column("x", Integer),
            Column("y", Integer),
            Column("z", Integer),
        )
        t2.append_constraint(
            ForeignKeyConstraint(
                [t2.c.x, t2.c.z], [r2b.c.a, r2b.c.b], name="fk1"
            )
        )
        t2.append_constraint(
            ForeignKeyConstraint(
                [t2.c.y, t2.c.z], [r2b.c.a, r2b.c.b], name="fk2"
            )
        )

        if hook_type == "object":

            def include_object(object_, name, type_, reflected, compare_to):
                return not (
                    isinstance(object_, ForeignKeyConstraint)
                    and type_ == "foreign_key_constraint"
                    and name == "fk1"
                )

            diffs = self._fixture(m1, m2, object_filters=include_object)
        elif hook_type == "name":

            def include_name(name, type_, parent_names):
                if type_ == "index":
                    return True  # MariaDB thing

                if name == "fk1":
                    eq_(type_, "foreign_key_constraint")
                    eq_(
                        parent_names,
                        {
                            "schema_name": None,
                            "table_name": "t",
                            "schema_qualified_table_name": "t",
                        },
                    )
                    return False
                else:
                    return True

            diffs = self._fixture(m1, m2, name_filters=include_name)

        if hook_type == "object":
            self._assert_fk_diff(
                diffs[0], "remove_fk", "t", ["y"], "ref_a", ["a"], name="fk2"
            )
            self._assert_fk_diff(
                diffs[1],
                "add_fk",
                "t",
                ["y", "z"],
                "ref_b",
                ["a", "b"],
                name="fk2",
            )
            eq_(len(diffs), 2)
        elif hook_type == "name":
            eq_(
                {(d[0], d[1].name) for d in diffs},
                {("add_fk", "fk2"), ("add_fk", "fk1"), ("remove_fk", "fk2")},
            )


class AutogenerateFKOptionsTest(AutogenFixtureTest, TestBase):
    __backend__ = True

    def _fk_opts_fixture(self, old_opts, new_opts):
        m1 = MetaData()
        m2 = MetaData()

        Table(
            "some_table",
            m1,
            Column("id", Integer, primary_key=True),
            Column("test", String(10)),
        )

        Table(
            "user",
            m1,
            Column("id", Integer, primary_key=True),
            Column("name", String(50), nullable=False),
            Column("tid", Integer),
            ForeignKeyConstraint(["tid"], ["some_table.id"], **old_opts),
        )

        Table(
            "some_table",
            m2,
            Column("id", Integer, primary_key=True),
            Column("test", String(10)),
        )

        Table(
            "user",
            m2,
            Column("id", Integer, primary_key=True),
            Column("name", String(50), nullable=False),
            Column("tid", Integer),
            ForeignKeyConstraint(["tid"], ["some_table.id"], **new_opts),
        )

        return self._fixture(m1, m2)

    @config.requirements.fk_ondelete_is_reflected
    def test_add_ondelete(self):
        diffs = self._fk_opts_fixture({}, {"ondelete": "cascade"})

        self._assert_fk_diff(
            diffs[0],
            "remove_fk",
            "user",
            ["tid"],
            "some_table",
            ["id"],
            ondelete=None,
            conditional_name="servergenerated",
        )

        self._assert_fk_diff(
            diffs[1],
            "add_fk",
            "user",
            ["tid"],
            "some_table",
            ["id"],
            ondelete="cascade",
        )

    @config.requirements.fk_ondelete_is_reflected
    def test_remove_ondelete(self):
        diffs = self._fk_opts_fixture({"ondelete": "CASCADE"}, {})

        self._assert_fk_diff(
            diffs[0],
            "remove_fk",
            "user",
            ["tid"],
            "some_table",
            ["id"],
            ondelete="CASCADE",
            conditional_name="servergenerated",
        )

        self._assert_fk_diff(
            diffs[1],
            "add_fk",
            "user",
            ["tid"],
            "some_table",
            ["id"],
            ondelete=None,
        )

    def test_nochange_ondelete(self):
        """test case sensitivity"""
        diffs = self._fk_opts_fixture(
            {"ondelete": "caSCAde"}, {"ondelete": "CasCade"}
        )
        eq_(diffs, [])

    @config.requirements.fk_onupdate_is_reflected
    def test_add_onupdate(self):
        diffs = self._fk_opts_fixture({}, {"onupdate": "cascade"})

        self._assert_fk_diff(
            diffs[0],
            "remove_fk",
            "user",
            ["tid"],
            "some_table",
            ["id"],
            onupdate=None,
            conditional_name="servergenerated",
        )

        self._assert_fk_diff(
            diffs[1],
            "add_fk",
            "user",
            ["tid"],
            "some_table",
            ["id"],
            onupdate="cascade",
        )

    @config.requirements.fk_onupdate_is_reflected
    def test_remove_onupdate(self):
        diffs = self._fk_opts_fixture({"onupdate": "CASCADE"}, {})

        self._assert_fk_diff(
            diffs[0],
            "remove_fk",
            "user",
            ["tid"],
            "some_table",
            ["id"],
            onupdate="CASCADE",
            conditional_name="servergenerated",
        )

        self._assert_fk_diff(
            diffs[1],
            "add_fk",
            "user",
            ["tid"],
            "some_table",
            ["id"],
            onupdate=None,
        )

    @config.requirements.fk_onupdate
    def test_nochange_onupdate(self):
        """test case sensitivity"""
        diffs = self._fk_opts_fixture(
            {"onupdate": "caSCAde"}, {"onupdate": "CasCade"}
        )
        eq_(diffs, [])

    @config.requirements.fk_ondelete_restrict
    def test_nochange_ondelete_restrict(self):
        """test the RESTRICT option which MySQL doesn't report on"""

        diffs = self._fk_opts_fixture(
            {"ondelete": "restrict"}, {"ondelete": "restrict"}
        )
        eq_(diffs, [])

    @config.requirements.fk_onupdate_restrict
    def test_nochange_onupdate_restrict(self):
        """test the RESTRICT option which MySQL doesn't report on"""

        diffs = self._fk_opts_fixture(
            {"onupdate": "restrict"}, {"onupdate": "restrict"}
        )
        eq_(diffs, [])

    @config.requirements.fk_ondelete_noaction
    def test_nochange_ondelete_noaction(self):
        """test the NO ACTION option which generally comes back as None"""

        diffs = self._fk_opts_fixture(
            {"ondelete": "no action"}, {"ondelete": "no action"}
        )
        eq_(diffs, [])

    @config.requirements.fk_onupdate
    def test_nochange_onupdate_noaction(self):
        """test the NO ACTION option which generally comes back as None"""

        diffs = self._fk_opts_fixture(
            {"onupdate": "no action"}, {"onupdate": "no action"}
        )
        eq_(diffs, [])

    @config.requirements.fk_ondelete_restrict
    def test_change_ondelete_from_restrict(self):
        """test the RESTRICT option which MySQL doesn't report on"""

        # note that this is impossible to detect if we change
        # from RESTRICT to NO ACTION on MySQL.
        diffs = self._fk_opts_fixture(
            {"ondelete": "restrict"}, {"ondelete": "cascade"}
        )
        self._assert_fk_diff(
            diffs[0],
            "remove_fk",
            "user",
            ["tid"],
            "some_table",
            ["id"],
            onupdate=None,
            ondelete=mock.ANY,  # MySQL reports None, PG reports RESTRICT
            conditional_name="servergenerated",
        )

        self._assert_fk_diff(
            diffs[1],
            "add_fk",
            "user",
            ["tid"],
            "some_table",
            ["id"],
            onupdate=None,
            ondelete="cascade",
        )

    @config.requirements.fk_ondelete_restrict
    def test_change_onupdate_from_restrict(self):
        """test the RESTRICT option which MySQL doesn't report on"""

        # note that this is impossible to detect if we change
        # from RESTRICT to NO ACTION on MySQL.
        diffs = self._fk_opts_fixture(
            {"onupdate": "restrict"}, {"onupdate": "cascade"}
        )
        self._assert_fk_diff(
            diffs[0],
            "remove_fk",
            "user",
            ["tid"],
            "some_table",
            ["id"],
            onupdate=mock.ANY,  # MySQL reports None, PG reports RESTRICT
            ondelete=None,
            conditional_name="servergenerated",
        )

        self._assert_fk_diff(
            diffs[1],
            "add_fk",
            "user",
            ["tid"],
            "some_table",
            ["id"],
            onupdate="cascade",
            ondelete=None,
        )

    @config.requirements.fk_ondelete_is_reflected
    @config.requirements.fk_onupdate_is_reflected
    def test_ondelete_onupdate_combo(self):
        diffs = self._fk_opts_fixture(
            {"onupdate": "CASCADE", "ondelete": "SET NULL"},
            {"onupdate": "RESTRICT", "ondelete": "RESTRICT"},
        )

        self._assert_fk_diff(
            diffs[0],
            "remove_fk",
            "user",
            ["tid"],
            "some_table",
            ["id"],
            onupdate="CASCADE",
            ondelete="SET NULL",
            conditional_name="servergenerated",
        )

        self._assert_fk_diff(
            diffs[1],
            "add_fk",
            "user",
            ["tid"],
            "some_table",
            ["id"],
            onupdate="RESTRICT",
            ondelete="RESTRICT",
        )

    @config.requirements.fk_initially
    def test_add_initially_deferred(self):
        diffs = self._fk_opts_fixture({}, {"initially": "deferred"})

        self._assert_fk_diff(
            diffs[0],
            "remove_fk",
            "user",
            ["tid"],
            "some_table",
            ["id"],
            initially=None,
            conditional_name="servergenerated",
        )

        self._assert_fk_diff(
            diffs[1],
            "add_fk",
            "user",
            ["tid"],
            "some_table",
            ["id"],
            initially="deferred",
        )

    @config.requirements.fk_initially
    def test_remove_initially_deferred(self):
        diffs = self._fk_opts_fixture({"initially": "deferred"}, {})

        self._assert_fk_diff(
            diffs[0],
            "remove_fk",
            "user",
            ["tid"],
            "some_table",
            ["id"],
            initially="DEFERRED",
            deferrable=True,
            conditional_name="servergenerated",
        )

        self._assert_fk_diff(
            diffs[1],
            "add_fk",
            "user",
            ["tid"],
            "some_table",
            ["id"],
            initially=None,
        )

    @config.requirements.fk_deferrable
    @config.requirements.fk_initially
    def test_add_initially_immediate_plus_deferrable(self):
        diffs = self._fk_opts_fixture(
            {}, {"initially": "immediate", "deferrable": True}
        )

        self._assert_fk_diff(
            diffs[0],
            "remove_fk",
            "user",
            ["tid"],
            "some_table",
            ["id"],
            initially=None,
            conditional_name="servergenerated",
        )

        self._assert_fk_diff(
            diffs[1],
            "add_fk",
            "user",
            ["tid"],
            "some_table",
            ["id"],
            initially="immediate",
            deferrable=True,
        )

    @config.requirements.fk_deferrable
    @config.requirements.fk_initially
    def test_remove_initially_immediate_plus_deferrable(self):
        diffs = self._fk_opts_fixture(
            {"initially": "immediate", "deferrable": True}, {}
        )

        self._assert_fk_diff(
            diffs[0],
            "remove_fk",
            "user",
            ["tid"],
            "some_table",
            ["id"],
            initially=None,  # immediate is the default
            deferrable=True,
            conditional_name="servergenerated",
        )

        self._assert_fk_diff(
            diffs[1],
            "add_fk",
            "user",
            ["tid"],
            "some_table",
            ["id"],
            initially=None,
            deferrable=None,
        )

    @config.requirements.fk_initially
    @config.requirements.fk_deferrable
    def test_add_initially_deferrable_nochange_one(self):
        diffs = self._fk_opts_fixture(
            {"deferrable": True, "initially": "immediate"},
            {"deferrable": True, "initially": "immediate"},
        )

        eq_(diffs, [])

    @config.requirements.fk_initially
    @config.requirements.fk_deferrable
    def test_add_initially_deferrable_nochange_two(self):
        diffs = self._fk_opts_fixture(
            {"deferrable": True, "initially": "deferred"},
            {"deferrable": True, "initially": "deferred"},
        )

        eq_(diffs, [])

    @config.requirements.fk_initially
    @config.requirements.fk_deferrable
    def test_add_initially_deferrable_nochange_three(self):
        diffs = self._fk_opts_fixture(
            {"deferrable": None, "initially": "deferred"},
            {"deferrable": None, "initially": "deferred"},
        )

        eq_(diffs, [])

    @config.requirements.fk_deferrable
    def test_add_deferrable(self):
        diffs = self._fk_opts_fixture({}, {"deferrable": True})

        self._assert_fk_diff(
            diffs[0],
            "remove_fk",
            "user",
            ["tid"],
            "some_table",
            ["id"],
            deferrable=None,
            conditional_name="servergenerated",
        )

        self._assert_fk_diff(
            diffs[1],
            "add_fk",
            "user",
            ["tid"],
            "some_table",
            ["id"],
            deferrable=True,
        )

    @config.requirements.fk_deferrable_is_reflected
    def test_remove_deferrable(self):
        diffs = self._fk_opts_fixture({"deferrable": True}, {})

        self._assert_fk_diff(
            diffs[0],
            "remove_fk",
            "user",
            ["tid"],
            "some_table",
            ["id"],
            deferrable=True,
            conditional_name="servergenerated",
        )

        self._assert_fk_diff(
            diffs[1],
            "add_fk",
            "user",
            ["tid"],
            "some_table",
            ["id"],
            deferrable=None,
        )
