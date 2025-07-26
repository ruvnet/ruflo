# testing/suite/test_reflection.py
# Copyright (C) 2005-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php
# mypy: ignore-errors

import operator
import re

import sqlalchemy as sa
from .. import config
from .. import engines
from .. import eq_
from .. import expect_raises
from .. import expect_raises_message
from .. import expect_warnings
from .. import fixtures
from .. import is_
from ..provision import get_temp_table_name
from ..provision import temp_table_keyword_args
from ..schema import Column
from ..schema import Table
from ... import event
from ... import ForeignKey
from ... import func
from ... import Identity
from ... import inspect
from ... import Integer
from ... import MetaData
from ... import String
from ... import testing
from ... import types as sql_types
from ...engine import Inspector
from ...engine import ObjectKind
from ...engine import ObjectScope
from ...exc import NoSuchTableError
from ...exc import UnreflectableTableError
from ...schema import DDL
from ...schema import Index
from ...sql.elements import quoted_name
from ...sql.schema import BLANK_SCHEMA
from ...testing import ComparesIndexes
from ...testing import ComparesTables
from ...testing import is_false
from ...testing import is_true
from ...testing import mock


metadata, users = None, None


class OneConnectionTablesTest(fixtures.TablesTest):
    @classmethod
    def setup_bind(cls):
        # TODO: when temp tables are subject to server reset,
        # this will also have to disable that server reset from
        # happening
        if config.requirements.independent_connections.enabled:
            from sqlalchemy import pool

            return engines.testing_engine(
                options=dict(poolclass=pool.StaticPool, scope="class"),
            )
        else:
            return config.db


class HasTableTest(OneConnectionTablesTest):
    __backend__ = True

    @classmethod
    def define_tables(cls, metadata):
        Table(
            "test_table",
            metadata,
            Column("id", Integer, primary_key=True),
            Column("data", String(50)),
        )
        if testing.requires.schemas.enabled:
            Table(
                "test_table_s",
                metadata,
                Column("id", Integer, primary_key=True),
                Column("data", String(50)),
                schema=config.test_schema,
            )

        if testing.requires.view_reflection:
            cls.define_views(metadata)
        if testing.requires.has_temp_table.enabled:
            cls.define_temp_tables(metadata)

    @classmethod
    def define_views(cls, metadata):
        query = "CREATE VIEW vv AS SELECT id, data FROM test_table"

        event.listen(metadata, "after_create", DDL(query))
        event.listen(metadata, "before_drop", DDL("DROP VIEW vv"))

        if testing.requires.schemas.enabled:
            query = (
                "CREATE VIEW %s.vv AS SELECT id, data FROM %s.test_table_s"
                % (
                    config.test_schema,
                    config.test_schema,
                )
            )
            event.listen(metadata, "after_create", DDL(query))
            event.listen(
                metadata,
                "before_drop",
                DDL("DROP VIEW %s.vv" % (config.test_schema)),
            )

    @classmethod
    def temp_table_name(cls):
        return get_temp_table_name(
            config, config.db, f"user_tmp_{config.ident}"
        )

    @classmethod
    def define_temp_tables(cls, metadata):
        kw = temp_table_keyword_args(config, config.db)
        table_name = cls.temp_table_name()
        user_tmp = Table(
            table_name,
            metadata,
            Column("id", sa.INT, primary_key=True),
            Column("name", sa.VARCHAR(50)),
            **kw,
        )
        if (
            testing.requires.view_reflection.enabled
            and testing.requires.temporary_views.enabled
        ):
            event.listen(
                user_tmp,
                "after_create",
                DDL(
                    "create temporary view user_tmp_v as "
                    "select * from user_tmp_%s" % config.ident
                ),
            )
            event.listen(user_tmp, "before_drop", DDL("drop view user_tmp_v"))

    def test_has_table(self):
        with config.db.begin() as conn:
            is_true(config.db.dialect.has_table(conn, "test_table"))
            is_false(config.db.dialect.has_table(conn, "test_table_s"))
            is_false(config.db.dialect.has_table(conn, "nonexistent_table"))

    def test_has_table_cache(self, metadata):
        insp = inspect(config.db)
        is_true(insp.has_table("test_table"))
        nt = Table("new_table", metadata, Column("col", Integer))
        is_false(insp.has_table("new_table"))
        nt.create(config.db)
        try:
            is_false(insp.has_table("new_table"))
            insp.clear_cache()
            is_true(insp.has_table("new_table"))
        finally:
            nt.drop(config.db)

    @testing.requires.schemas
    def test_has_table_schema(self):
        with config.db.begin() as conn:
            is_false(
                config.db.dialect.has_table(
                    conn, "test_table", schema=config.test_schema
                )
            )
            is_true(
                config.db.dialect.has_table(
                    conn, "test_table_s", schema=config.test_schema
                )
            )
            is_false(
                config.db.dialect.has_table(
                    conn, "nonexistent_table", schema=config.test_schema
                )
            )

    @testing.requires.schemas
    def test_has_table_nonexistent_schema(self):
        with config.db.begin() as conn:
            is_false(
                config.db.dialect.has_table(
                    conn, "test_table", schema="nonexistent_schema"
                )
            )

    @testing.requires.views
    def test_has_table_view(self, connection):
        insp = inspect(connection)
        is_true(insp.has_table("vv"))

    @testing.requires.has_temp_table
    def test_has_table_temp_table(self, connection):
        insp = inspect(connection)
        temp_table_name = self.temp_table_name()
        is_true(insp.has_table(temp_table_name))

    @testing.requires.has_temp_table
    @testing.requires.view_reflection
    @testing.requires.temporary_views
    def test_has_table_temp_view(self, connection):
        insp = inspect(connection)
        is_true(insp.has_table("user_tmp_v"))

    @testing.requires.views
    @testing.requires.schemas
    def test_has_table_view_schema(self, connection):
        insp = inspect(connection)
        is_true(insp.has_table("vv", config.test_schema))


class HasIndexTest(fixtures.TablesTest):
    __backend__ = True

    @classmethod
    def define_tables(cls, metadata):
        tt = Table(
            "test_table",
            metadata,
            Column("id", Integer, primary_key=True),
            Column("data", String(50)),
            Column("data2", String(50)),
        )
        Index("my_idx", tt.c.data)

        if testing.requires.schemas.enabled:
            tt = Table(
                "test_table",
                metadata,
                Column("id", Integer, primary_key=True),
                Column("data", String(50)),
                schema=config.test_schema,
            )
            Index("my_idx_s", tt.c.data)

    kind = testing.combinations("dialect", "inspector", argnames="kind")

    def _has_index(self, kind, conn):
        if kind == "dialect":
            return lambda *a, **k: config.db.dialect.has_index(conn, *a, **k)
        else:
            return inspect(conn).has_index

    @kind
    def test_has_index(self, kind, connection, metadata):
        meth = self._has_index(kind, connection)
        assert meth("test_table", "my_idx")
        assert not meth("test_table", "my_idx_s")
        assert not meth("nonexistent_table", "my_idx")
        assert not meth("test_table", "nonexistent_idx")

        assert not meth("test_table", "my_idx_2")
        assert not meth("test_table_2", "my_idx_3")
        idx = Index("my_idx_2", self.tables.test_table.c.data2)
        tbl = Table(
            "test_table_2",
            metadata,
            Column("foo", Integer),
            Index("my_idx_3", "foo"),
        )
        idx.create(connection)
        tbl.create(connection)
        try:
            if kind == "inspector":
                assert not meth("test_table", "my_idx_2")
                assert not meth("test_table_2", "my_idx_3")
                meth.__self__.clear_cache()
            assert meth("test_table", "my_idx_2") is True
            assert meth("test_table_2", "my_idx_3") is True
        finally:
            tbl.drop(connection)
            idx.drop(connection)

    @testing.requires.schemas
    @kind
    def test_has_index_schema(self, kind, connection):
        meth = self._has_index(kind, connection)
        assert meth("test_table", "my_idx_s", schema=config.test_schema)
        assert not meth("test_table", "my_idx", schema=config.test_schema)
        assert not meth(
            "nonexistent_table", "my_idx_s", schema=config.test_schema
        )
        assert not meth(
            "test_table", "nonexistent_idx_s", schema=config.test_schema
        )


class BizarroCharacterFKResolutionTest(fixtures.TestBase):
    """tests for #10275"""

    __backend__ = True

    @testing.combinations(
        ("id",), ("(3)",), ("col%p",), ("[brack]",), argnames="columnname"
    )
    @testing.variation("use_composite", [True, False])
    @testing.combinations(
        ("plain",),
        ("(2)",),
        ("per % cent",),
        ("[brackets]",),
        argnames="tablename",
    )
    def test_fk_ref(
        self, connection, metadata, use_composite, tablename, columnname
    ):
        tt = Table(
            tablename,
            metadata,
            Column(columnname, Integer, key="id", primary_key=True),
            test_needs_fk=True,
        )
        if use_composite:
            tt.append_column(Column("id2", Integer, primary_key=True))

        if use_composite:
            Table(
                "other",
                metadata,
                Column("id", Integer, primary_key=True),
                Column("ref", Integer),
                Column("ref2", Integer),
                sa.ForeignKeyConstraint(["ref", "ref2"], [tt.c.id, tt.c.id2]),
                test_needs_fk=True,
            )
        else:
            Table(
                "other",
                metadata,
                Column("id", Integer, primary_key=True),
                Column("ref", ForeignKey(tt.c.id)),
                test_needs_fk=True,
            )

        metadata.create_all(connection)

        m2 = MetaData()

        o2 = Table("other", m2, autoload_with=connection)
        t1 = m2.tables[tablename]

        assert o2.c.ref.references(t1.c[0])
        if use_composite:
            assert o2.c.ref2.references(t1.c[1])


class QuotedNameArgumentTest(fixtures.TablesTest):
    run_create_tables = "once"
    __backend__ = True

    @classmethod
    def define_tables(cls, metadata):
        Table(
            "quote ' one",
            metadata,
            Column("id", Integer),
            Column("name", String(50)),
            Column("data", String(50)),
            Column("related_id", Integer),
            sa.PrimaryKeyConstraint("id", name="pk quote ' one"),
            sa.Index("ix quote ' one", "name"),
            sa.UniqueConstraint(
                "data",
                name="uq quote' one",
            ),
            sa.ForeignKeyConstraint(
                ["id"], ["related.id"], name="fk quote ' one"
            ),
            sa.CheckConstraint("name != 'foo'", name="ck quote ' one"),
            comment=r"""quote ' one comment""",
            test_needs_fk=True,
        )

        if testing.requires.symbol_names_w_double_quote.enabled:
            Table(
                'quote " two',
                metadata,
                Column("id", Integer),
                Column("name", String(50)),
                Column("data", String(50)),
                Column("related_id", Integer),
                sa.PrimaryKeyConstraint("id", name='pk quote " two'),
                sa.Index('ix quote " two', "name"),
                sa.UniqueConstraint(
                    "data",
                    name='uq quote" two',
                ),
                sa.ForeignKeyConstraint(
                    ["id"], ["related.id"], name='fk quote " two'
                ),
                sa.CheckConstraint("name != 'foo'", name='ck quote " two '),
                comment=r"""quote " two comment""",
                test_needs_fk=True,
            )

        Table(
            "related",
            metadata,
            Column("id", Integer, primary_key=True),
            Column("related", Integer),
            test_needs_fk=True,
        )

        if testing.requires.view_column_reflection.enabled:
            if testing.requires.symbol_names_w_double_quote.enabled:
                names = [
                    "quote ' one",
                    'quote " two',
                ]
            else:
                names = [
                    "quote ' one",
                ]
            for name in names:
                query = "CREATE VIEW %s AS SELECT * FROM %s" % (
                    config.db.dialect.identifier_preparer.quote(
                        "view %s" % name
                    ),
                    config.db.dialect.identifier_preparer.quote(name),
                )

                event.listen(metadata, "after_create", DDL(query))
                event.listen(
                    metadata,
                    "before_drop",
                    DDL(
                        "DROP VIEW %s"
                        % config.db.dialect.identifier_preparer.quote(
                            "view %s" % name
                        )
                    ),
                )

    def quote_fixtures(fn):
        return testing.combinations(
            ("quote ' one",),
            ('quote " two', testing.requires.symbol_names_w_double_quote),
        )(fn)

    @quote_fixtures
    def test_get_table_options(self, name):
        insp = inspect(config.db)

        if testing.requires.reflect_table_options.enabled:
            res = insp.get_table_options(name)
            is_true(isinstance(res, dict))
        else:
            with expect_raises(NotImplementedError):
                res = insp.get_table_options(name)

    @quote_fixtures
    @testing.requires.view_column_reflection
    def test_get_view_definition(self, name):
        insp = inspect(config.db)
        assert insp.get_view_definition("view %s" % name)

    @quote_fixtures
    def test_get_columns(self, name):
        insp = inspect(config.db)
        assert insp.get_columns(name)

    @quote_fixtures
    def test_get_pk_constraint(self, name):
        insp = inspect(config.db)
        assert insp.get_pk_constraint(name)

    @quote_fixtures
    def test_get_foreign_keys(self, name):
        insp = inspect(config.db)
        assert insp.get_foreign_keys(name)

    @quote_fixtures
    def test_get_indexes(self, name):
        insp = inspect(config.db)
        assert insp.get_indexes(name)

    @quote_fixtures
    @testing.requires.unique_constraint_reflection
    def test_get_unique_constraints(self, name):
        insp = inspect(config.db)
        assert insp.get_unique_constraints(name)

    @quote_fixtures
    @testing.requires.comment_reflection
    def test_get_table_comment(self, name):
        insp = inspect(config.db)
        assert insp.get_table_comment(name)

    @quote_fixtures
    @testing.requires.check_constraint_reflection
    def test_get_check_constraints(self, name):
        insp = inspect(config.db)
        assert insp.get_check_constraints(name)


def _multi_combination(fn):
    schema = testing.combinations(
        None,
        (
            lambda: config.test_schema,
            testing.requires.schemas,
        ),
        argnames="schema",
    )
    scope = testing.combinations(
        ObjectScope.DEFAULT,
        ObjectScope.TEMPORARY,
        ObjectScope.ANY,
        argnames="scope",
    )
    kind = testing.combinations(
        ObjectKind.TABLE,
        ObjectKind.VIEW,
        ObjectKind.MATERIALIZED_VIEW,
        ObjectKind.ANY,
        ObjectKind.ANY_VIEW,
        ObjectKind.TABLE | ObjectKind.VIEW,
        ObjectKind.TABLE | ObjectKind.MATERIALIZED_VIEW,
        argnames="kind",
    )
    filter_names = testing.combinations(True, False, argnames="use_filter")

    return schema(scope(kind(filter_names(fn))))


class ComponentReflectionTest(ComparesTables, OneConnectionTablesTest):
    run_inserts = run_deletes = None

    __backend__ = True

    @classmethod
    def define_tables(cls, metadata):
        cls.define_reflected_tables(metadata, None)
        if testing.requires.schemas.enabled:
            cls.define_reflected_tables(metadata, testing.config.test_schema)

    @classmethod
    def define_reflected_tables(cls, metadata, schema):
        if schema:
            schema_prefix = schema + "."
        else:
            schema_prefix = ""

        if testing.requires.self_referential_foreign_keys.enabled:
            parent_id_args = (
                ForeignKey(
                    "%susers.user_id" % schema_prefix, name="user_id_fk"
                ),
            )
        else:
            parent_id_args = ()
        users = Table(
            "users",
            metadata,
            Column("user_id", sa.INT, primary_key=True),
            Column("test1", sa.CHAR(5), nullable=False),
            Column("test2", sa.Float(), nullable=False),
            Column("parent_user_id", sa.Integer, *parent_id_args),
            sa.CheckConstraint(
                "test2 > 0",
                name="zz_test2_gt_zero",
                comment="users check constraint",
            ),
            sa.CheckConstraint("test2 <= 1000"),
            schema=schema,
            test_needs_fk=True,
        )

        Table(
            "dingalings",
            metadata,
            Column("dingaling_id", sa.Integer, primary_key=True),
            Column(
                "address_id",
                sa.Integer,
                ForeignKey(
                    "%semail_addresses.address_id" % schema_prefix,
                    name="zz_email_add_id_fg",
                    comment="di fk comment",
                ),
            ),
            Column(
                "id_user",
                sa.Integer,
                ForeignKey("%susers.user_id" % schema_prefix),
            ),
            Column("data", sa.String(30), unique=True),
            sa.CheckConstraint(
                "address_id > 0 AND address_id < 1000",
                name="address_id_gt_zero",
            ),
            sa.UniqueConstraint(
                "address_id",
                "dingaling_id",
                name="zz_dingalings_multiple",
                comment="di unique comment",
            ),
            schema=schema,
            test_needs_fk=True,
        )
        Table(
            "email_addresses",
            metadata,
            Column("address_id", sa.Integer),
            Column("remote_user_id", sa.Integer, ForeignKey(users.c.user_id)),
            Column("email_address", sa.String(20), index=True),
            sa.PrimaryKeyConstraint(
                "address_id", name="email_ad_pk", comment="ea pk comment"
            ),
            schema=schema,
            test_needs_fk=True,
        )
        Table(
            "comment_test",
            metadata,
            Column("id", sa.Integer, primary_key=True, comment="id comment"),
            Column("data", sa.String(20), comment="data % comment"),
            Column(
                "d2",
                sa.String(20),
                comment=r"""Comment types type speedily ' " \ '' Fun!""",
            ),
            Column("d3", sa.String(42), comment="Comment\nwith\rescapes"),
            schema=schema,
            comment=r"""the test % ' " \ table comment""",
        )
        Table(
            "no_constraints",
            metadata,
            Column("data", sa.String(20)),
            schema=schema,
            comment="no\nconstraints\rhas\fescaped\vcomment",
        )

        if testing.requires.cross_schema_fk_reflection.enabled:
            if schema is None:
                Table(
                    "local_table",
                    metadata,
                    Column("id", sa.Integer, primary_key=True),
                    Column("data", sa.String(20)),
                    Column(
                        "remote_id",
                        ForeignKey(
                            "%s.remote_table_2.id" % testing.config.test_schema
                        ),
                    ),
                    test_needs_fk=True,
                    schema=config.db.dialect.default_schema_name,
                )
            else:
                Table(
                    "remote_table",
                    metadata,
                    Column("id", sa.Integer, primary_key=True),
                    Column(
                        "local_id",
                        ForeignKey(
                            "%s.local_table.id"
                            % config.db.dialect.default_schema_name
                        ),
                    ),
                    Column("data", sa.String(20)),
                    schema=schema,
                    test_needs_fk=True,
                )
                Table(
                    "remote_table_2",
                    metadata,
                    Column("id", sa.Integer, primary_key=True),
                    Column("data", sa.String(20)),
                    schema=schema,
                    test_needs_fk=True,
                )

        if testing.requires.index_reflection.enabled:
            Index("users_t_idx", users.c.test1, users.c.test2, unique=True)
            Index(
                "users_all_idx", users.c.user_id, users.c.test2, users.c.test1
            )

            if not schema:
                # test_needs_fk is at the moment to force MySQL InnoDB
                noncol_idx_test_nopk = Table(
                    "noncol_idx_test_nopk",
                    metadata,
                    Column("q", sa.String(5)),
                    test_needs_fk=True,
                )

                noncol_idx_test_pk = Table(
                    "noncol_idx_test_pk",
                    metadata,
                    Column("id", sa.Integer, primary_key=True),
                    Column("q", sa.String(5)),
                    test_needs_fk=True,
                )

                if (
                    testing.requires.indexes_with_ascdesc.enabled
                    and testing.requires.reflect_indexes_with_ascdesc.enabled
                ):
                    Index("noncol_idx_nopk", noncol_idx_test_nopk.c.q.desc())
                    Index("noncol_idx_pk", noncol_idx_test_pk.c.q.desc())

        if testing.requires.view_column_reflection.enabled:
            cls.define_views(metadata, schema)
        if not schema and testing.requires.temp_table_reflection.enabled:
            cls.define_temp_tables(metadata)

    @classmethod
    def temp_table_name(cls):
        return get_temp_table_name(
            config, config.db, f"user_tmp_{config.ident}"
        )

    @classmethod
    def define_temp_tables(cls, metadata):
        kw = temp_table_keyword_args(config, config.db)
        table_name = cls.temp_table_name()
        user_tmp = Table(
            table_name,
            metadata,
            Column("id", sa.INT, primary_key=True),
            Column("name", sa.VARCHAR(50)),
            Column("foo", sa.INT),
            # disambiguate temp table unique constraint names.  this is
            # pretty arbitrary for a generic dialect however we are doing
            # it to suit SQL Server which will produce name conflicts for
            # unique constraints created against temp tables in different
            # databases.
            # https://www.arbinada.com/en/node/1645
            sa.UniqueConstraint("name", name=f"user_tmp_uq_{config.ident}"),
            sa.Index("user_tmp_ix", "foo"),
            **kw,
        )
        if (
            testing.requires.view_reflection.enabled
            and testing.requires.temporary_views.enabled
        ):
            event.listen(
                user_tmp,
                "after_create",
                DDL(
                    "create temporary view user_tmp_v as "
                    "select * from user_tmp_%s" % config.ident
                ),
            )
            event.listen(user_tmp, "before_drop", DDL("drop view user_tmp_v"))

    @classmethod
    def define_views(cls, metadata, schema):
        if testing.requires.materialized_views.enabled:
            materialized = {"dingalings"}
        else:
            materialized = set()
        for table_name in ("users", "email_addresses", "dingalings"):
            fullname = table_name
            if schema:
                fullname = f"{schema}.{table_name}"
            view_name = fullname + "_v"
            prefix = "MATERIALIZED " if table_name in materialized else ""
            query = (
                f"CREATE {prefix}VIEW {view_name} AS SELECT * FROM {fullname}"
            )

            event.listen(metadata, "after_create", DDL(query))
            if table_name in materialized:
                index_name = "mat_index"
                if schema and testing.against("oracle"):
                    index_name = f"{schema}.{index_name}"
                idx = f"CREATE INDEX {index_name} ON {view_name}(data)"
                event.listen(metadata, "after_create", DDL(idx))
            event.listen(
                metadata, "before_drop", DDL(f"DROP {prefix}VIEW {view_name}")
            )

    def _resolve_kind(self, kind, tables, views, materialized):
        res = {}
        if ObjectKind.TABLE in kind:
            res.update(tables)
        if ObjectKind.VIEW in kind:
            res.update(views)
        if ObjectKind.MATERIALIZED_VIEW in kind:
            res.update(materialized)
        return res

    def _resolve_views(self, views, materialized):
        if not testing.requires.view_column_reflection.enabled:
            materialized.clear()
            views.clear()
        elif not testing.requires.materialized_views.enabled:
            views.update(materialized)
            materialized.clear()

    def _resolve_names(self, schema, scope, filter_names, values):
        scope_filter = lambda _: True  # noqa: E731
        if scope is ObjectScope.DEFAULT:
            scope_filter = lambda k: "tmp" not in k[1]  # noqa: E731
        if scope is ObjectScope.TEMPORARY:
            scope_filter = lambda k: "tmp" in k[1]  # noqa: E731

        removed = {
            None: {"remote_table", "remote_table_2"},
            testing.config.test_schema: {
                "local_table",
                "noncol_idx_test_nopk",
                "noncol_idx_test_pk",
                "user_tmp_v",
                self.temp_table_name(),
            },
        }
        if not testing.requires.cross_schema_fk_reflection.enabled:
            removed[None].add("local_table")
            removed[testing.config.test_schema].update(
                ["remote_table", "remote_table_2"]
            )
        if not testing.requires.index_reflection.enabled:
            removed[None].update(
                ["noncol_idx_test_nopk", "noncol_idx_test_pk"]
            )
        if (
            not testing.requires.temp_table_reflection.enabled
            or not testing.requires.temp_table_names.enabled
        ):
            removed[None].update(["user_tmp_v", self.temp_table_name()])
        if not testing.requires.temporary_views.enabled:
            removed[None].update(["user_tmp_v"])

        res = {
            k: v
            for k, v in values.items()
            if scope_filter(k)
            and k[1] not in removed[schema]
            and (not filter_names or k[1] in filter_names)
        }
        return res

    def exp_options(
        self,
        schema=None,
        scope=ObjectScope.ANY,
        kind=ObjectKind.ANY,
        filter_names=None,
    ):
        materialized = {(schema, "dingalings_v"): mock.ANY}
        views = {
            (schema, "email_addresses_v"): mock.ANY,
            (schema, "users_v"): mock.ANY,
            (schema, "user_tmp_v"): mock.ANY,
        }
        self._resolve_views(views, materialized)
        tables = {
            (schema, "users"): mock.ANY,
            (schema, "dingalings"): mock.ANY,
            (schema, "email_addresses"): mock.ANY,
            (schema, "comment_test"): mock.ANY,
            (schema, "no_constraints"): mock.ANY,
            (schema, "local_table"): mock.ANY,
            (schema, "remote_table"): mock.ANY,
            (schema, "remote_table_2"): mock.ANY,
            (schema, "noncol_idx_test_nopk"): mock.ANY,
            (schema, "noncol_idx_test_pk"): mock.ANY,
            (schema, self.temp_table_name()): mock.ANY,
        }
        res = self._resolve_kind(kind, tables, views, materialized)
        res = self._resolve_names(schema, scope, filter_names, res)
        return res

    def exp_comments(
        self,
        schema=None,
        scope=ObjectScope.ANY,
        kind=ObjectKind.ANY,
        filter_names=None,
    ):
        empty = {"text": None}
        materialized = {(schema, "dingalings_v"): empty}
        views = {
            (schema, "email_addresses_v"): empty,
            (schema, "users_v"): empty,
            (schema, "user_tmp_v"): empty,
        }
        self._resolve_views(views, materialized)
        tables = {
            (schema, "users"): empty,
            (schema, "dingalings"): empty,
            (schema, "email_addresses"): empty,
            (schema, "comment_test"): {
                "text": r"""the test % ' " \ table comment"""
            },
            (schema, "no_constraints"): {
                "text": "no\nconstraints\rhas\fescaped\vcomment"
            },
            (schema, "local_table"): empty,
            (schema, "remote_table"): empty,
            (schema, "remote_table_2"): empty,
            (schema, "noncol_idx_test_nopk"): empty,
            (schema, "noncol_idx_test_pk"): empty,
            (schema, self.temp_table_name()): empty,
        }
        res = self._resolve_kind(kind, tables, views, materialized)
        res = self._resolve_names(schema, scope, filter_names, res)
        return res

    def exp_columns(
        self,
        schema=None,
        scope=ObjectScope.ANY,
        kind=ObjectKind.ANY,
        filter_names=None,
    ):
        def col(
            name, auto=False, default=mock.ANY, comment=None, nullable=True
        ):
            res = {
                "name": name,
                "autoincrement": auto,
                "type": mock.ANY,
                "default": default,
                "comment": comment,
                "nullable": nullable,
            }
            if auto == "omit":
                res.pop("autoincrement")
            return res

        def pk(name, **kw):
            kw = {"auto": True, "default": mock.ANY, "nullable": False, **kw}
            return col(name, **kw)

        materialized = {
            (schema, "dingalings_v"): [
                col("dingaling_id", auto="omit", nullable=mock.ANY),
                col("address_id"),
                col("id_user"),
                col("data"),
            ]
        }
        views = {
            (schema, "email_addresses_v"): [
                col("address_id", auto="omit", nullable=mock.ANY),
                col("remote_user_id"),
                col("email_address"),
            ],
            (schema, "users_v"): [
                col("user_id", auto="omit", nullable=mock.ANY),
                col("test1", nullable=mock.ANY),
                col("test2", nullable=mock.ANY),
                col("parent_user_id"),
            ],
            (schema, "user_tmp_v"): [
                col("id", auto="omit", nullable=mock.ANY),
                col("name"),
                col("foo"),
            ],
        }
        self._resolve_views(views, materialized)
        tables = {
            (schema, "users"): [
                pk("user_id"),
                col("test1", nullable=False),
                col("test2", nullable=False),
                col("parent_user_id"),
            ],
            (schema, "dingalings"): [
                pk("dingaling_id"),
                col("address_id"),
                col("id_user"),
                col("data"),
            ],
            (schema, "email_addresses"): [
                pk("address_id"),
                col("remote_user_id"),
                col("email_address"),
            ],
            (schema, "comment_test"): [
                pk("id", comment="id comment"),
                col("data", comment="data % comment"),
                col(
                    "d2",
                    comment=r"""Comment types type speedily ' " \ '' Fun!""",
                ),
                col("d3", comment="Comment\nwith\rescapes"),
            ],
            (schema, "no_constraints"): [col("data")],
            (schema, "local_table"): [pk("id"), col("data"), col("remote_id")],
            (schema, "remote_table"): [pk("id"), col("local_id"), col("data")],
            (schema, "remote_table_2"): [pk("id"), col("data")],
            (schema, "noncol_idx_test_nopk"): [col("q")],
            (schema, "noncol_idx_test_pk"): [pk("id"), col("q")],
            (schema, self.temp_table_name()): [
                pk("id"),
                col("name"),
                col("foo"),
            ],
        }
        res = self._resolve_kind(kind, tables, views, materialized)
        res = self._resolve_names(schema, scope, filter_names, res)
        return res

    @property
    def _required_column_keys(self):
        return {"name", "type", "nullable", "default"}

    def exp_pks(
        self,
        schema=None,
        scope=ObjectScope.ANY,
        kind=ObjectKind.ANY,
        filter_names=None,
    ):
        def pk(*cols, name=mock.ANY, comment=None):
            return {
                "constrained_columns": list(cols),
                "name": name,
                "comment": comment,
            }

        empty = pk(name=None)
        if testing.requires.materialized_views_reflect_pk.enabled:
            materialized = {(schema, "dingalings_v"): pk("dingaling_id")}
        else:
            materialized = {(schema, "dingalings_v"): empty}
        views = {
            (schema, "email_addresses_v"): empty,
            (schema, "users_v"): empty,
            (schema, "user_tmp_v"): empty,
        }
        self._resolve_views(views, materialized)
        tables = {
            (schema, "users"): pk("user_id"),
            (schema, "dingalings"): pk("dingaling_id"),
            (schema, "email_addresses"): pk(
                "address_id", name="email_ad_pk", comment="ea pk comment"
            ),
            (schema, "comment_test"): pk("id"),
            (schema, "no_constraints"): empty,
            (schema, "local_table"): pk("id"),
            (schema, "remote_table"): pk("id"),
            (schema, "remote_table_2"): pk("id"),
            (schema, "noncol_idx_test_nopk"): empty,
            (schema, "noncol_idx_test_pk"): pk("id"),
            (schema, self.temp_table_name()): pk("id"),
        }
        if not testing.requires.reflects_pk_names.enabled:
            for val in tables.values():
                if val["name"] is not None:
                    val["name"] = mock.ANY
        res = self._resolve_kind(kind, tables, views, materialized)
        res = self._resolve_names(schema, scope, filter_names, res)
        return res

    @property
    def _required_pk_keys(self):
        return {"name", "constrained_columns"}

    def exp_fks(
        self,
        schema=None,
        scope=ObjectScope.ANY,
        kind=ObjectKind.ANY,
        filter_names=None,
    ):
        class tt:
            def __eq__(self, other):
                return (
                    other is None
                    or config.db.dialect.default_schema_name == other
                )

        def fk(
            cols,
            ref_col,
            ref_table,
            ref_schema=schema,
            name=mock.ANY,
            comment=None,
        ):
            return {
                "constrained_columns": cols,
                "referred_columns": ref_col,
                "name": name,
                "options": mock.ANY,
                "referred_schema": ref_schema
                if ref_schema is not None
                else tt(),
                "referred_table": ref_table,
                "comment": comment,
            }

        materialized = {(schema, "dingalings_v"): []}
        views = {
            (schema, "email_addresses_v"): [],
            (schema, "users_v"): [],
            (schema, "user_tmp_v"): [],
        }
        self._resolve_views(views, materialized)
        tables = {
            (schema, "users"): [
                fk(["parent_user_id"], ["user_id"], "users", name="user_id_fk")
            ],
            (schema, "dingalings"): [
                fk(["id_user"], ["user_id"], "users"),
                fk(
                    ["address_id"],
                    ["address_id"],
                    "email_addresses",
                    name="zz_email_add_id_fg",
                    comment="di fk comment",
                ),
            ],
            (schema, "email_addresses"): [
                fk(["remote_user_id"], ["user_id"], "users")
            ],
            (schema, "comment_test"): [],
            (schema, "no_constraints"): [],
            (schema, "local_table"): [
                fk(
                    ["remote_id"],
                    ["id"],
                    "remote_table_2",
                    ref_schema=config.test_schema,
                )
            ],
            (schema, "remote_table"): [
                fk(["local_id"], ["id"], "local_table", ref_schema=None)
            ],
            (schema, "remote_table_2"): [],
            (schema, "noncol_idx_test_nopk"): [],
            (schema, "noncol_idx_test_pk"): [],
            (schema, self.temp_table_name()): [],
        }
        if not testing.requires.self_referential_foreign_keys.enabled:
            tables[(schema, "users")].clear()
        if not testing.requires.named_constraints.enabled:
            for vals in tables.values():
                for val in vals:
                    if val["name"] is not mock.ANY:
                        val["name"] = mock.ANY

        res = self._resolve_kind(kind, tables, views, materialized)
        res = self._resolve_names(schema, scope, filter_names, res)
        return res

    @property
    def _required_fk_keys(self):
        return {
            "name",
            "constrained_columns",
            "referred_schema",
            "referred_table",
            "referred_columns",
        }

    def exp_indexes(
        self,
        schema=None,
        scope=ObjectScope.ANY,
        kind=ObjectKind.ANY,
        filter_names=None,
    ):
        def idx(
            *cols,
            name,
            unique=False,
            column_sorting=None,
            duplicates=False,
            fk=False,
        ):
            fk_req = testing.requires.foreign_keys_reflect_as_index
            dup_req = testing.requires.unique_constraints_reflect_as_index
            sorting_expression = (
                testing.requires.reflect_indexes_with_ascdesc_as_expression
            )

            if (fk and not fk_req.enabled) or (
                duplicates and not dup_req.enabled
            ):
                return ()
            res = {
                "unique": unique,
                "column_names": list(cols),
                "name": name,
                "dialect_options": mock.ANY,
                "include_columns": [],
            }
            if column_sorting:
                res["column_sorting"] = column_sorting
                if sorting_expression.enabled:
                    res["expressions"] = orig = res["column_names"]
                    res["column_names"] = [
                        None if c in column_sorting else c for c in orig
                    ]

            if duplicates:
                res["duplicates_constraint"] = name
            return [res]

        materialized = {(schema, "dingalings_v"): []}
        views = {
            (schema, "email_addresses_v"): [],
            (schema, "users_v"): [],
            (schema, "user_tmp_v"): [],
        }
        self._resolve_views(views, materialized)
        if materialized:
            materialized[(schema, "dingalings_v")].extend(
                idx("data", name="mat_index")
            )
        tables = {
            (schema, "users"): [
                *idx("parent_user_id", name="user_id_fk", fk=True),
                *idx("user_id", "test2", "test1", name="users_all_idx"),
                *idx("test1", "test2", name="users_t_idx", unique=True),
            ],
            (schema, "dingalings"): [
                *idx("data", name=mock.ANY, unique=True, duplicates=True),
                *idx("id_user", name=mock.ANY, fk=True),
                *idx(
                    "address_id",
                    "dingaling_id",
                    name="zz_dingalings_multiple",
                    unique=True,
                    duplicates=True,
                ),
            ],
            (schema, "email_addresses"): [
                *idx("email_address", name=mock.ANY),
                *idx("remote_user_id", name=mock.ANY, fk=True),
            ],
            (schema, "comment_test"): [],
            (schema, "no_constraints"): [],
            (schema, "local_table"): [
                *idx("remote_id", name=mock.ANY, fk=True)
            ],
            (schema, "remote_table"): [
                *idx("local_id", name=mock.ANY, fk=True)
            ],
            (schema, "remote_table_2"): [],
            (schema, "noncol_idx_test_nopk"): [
                *idx(
                    "q",
                    name="noncol_idx_nopk",
                    column_sorting={"q": ("desc",)},
                )
            ],
            (schema, "noncol_idx_test_pk"): [
                *idx(
                    "q", name="noncol_idx_pk", column_sorting={"q": ("desc",)}
                )
            ],
            (schema, self.temp_table_name()): [
                *idx("foo", name="user_tmp_ix"),
                *idx(
                    "name",
                    name=f"user_tmp_uq_{config.ident}",
                    duplicates=True,
                    unique=True,
                ),
            ],
        }
        if (
            not testing.requires.indexes_with_ascdesc.enabled
            or not testing.requires.reflect_indexes_with_ascdesc.enabled
        ):
            tables[(schema, "noncol_idx_test_nopk")].clear()
            tables[(schema, "noncol_idx_test_pk")].clear()
        res = self._resolve_kind(kind, tables, views, materialized)
        res = self._resolve_names(schema, scope, filter_names, res)
        return res

    @property
    def _required_index_keys(self):
        return {"name", "column_names", "unique"}

    def exp_ucs(
        self,
        schema=None,
        scope=ObjectScope.ANY,
        kind=ObjectKind.ANY,
        filter_names=None,
        all_=False,
    ):
        def uc(
            *cols, name, duplicates_index=None, is_index=False, comment=None
        ):
            req = testing.requires.unique_index_reflect_as_unique_constraints
            if is_index and not req.enabled:
                return ()
            res = {
                "column_names": list(cols),
                "name": name,
                "comment": comment,
            }
            if duplicates_index:
                res["duplicates_index"] = duplicates_index
            return [res]

        materialized = {(schema, "dingalings_v"): []}
        views = {
            (schema, "email_addresses_v"): [],
            (schema, "users_v"): [],
            (schema, "user_tmp_v"): [],
        }
        self._resolve_views(views, materialized)
        tables = {
            (schema, "users"): [
                *uc(
                    "test1",
                    "test2",
                    name="users_t_idx",
                    duplicates_index="users_t_idx",
                    is_index=True,
                )
            ],
            (schema, "dingalings"): [
                *uc("data", name=mock.ANY, duplicates_index=mock.ANY),
                *uc(
                    "address_id",
                    "dingaling_id",
                    name="zz_dingalings_multiple",
                    duplicates_index="zz_dingalings_multiple",
                    comment="di unique comment",
                ),
            ],
            (schema, "email_addresses"): [],
            (schema, "comment_test"): [],
            (schema, "no_constraints"): [],
            (schema, "local_table"): [],
            (schema, "remote_table"): [],
            (schema, "remote_table_2"): [],
            (schema, "noncol_idx_test_nopk"): [],
            (schema, "noncol_idx_test_pk"): [],
            (schema, self.temp_table_name()): [
                *uc("name", name=f"user_tmp_uq_{config.ident}")
            ],
        }
        if all_:
            return {**materialized, **views, **tables}
        else:
            res = self._resolve_kind(kind, tables, views, materialized)
            res = self._resolve_names(schema, scope, filter_names, res)
            return res

    @property
    def _required_unique_cst_keys(self):
        return {"name", "column_names"}

    def exp_ccs(
        self,
        schema=None,
        scope=ObjectScope.ANY,
        kind=ObjectKind.ANY,
        filter_names=None,
    ):
        class tt(str):
            def __eq__(self, other):
                res = (
                    other.lower()
                    .replace("(", "")
                    .replace(")", "")
                    .replace("`", "")
                )
                return self in res

        def cc(text, name, comment=None):
            return {"sqltext": tt(text), "name": name, "comment": comment}

        # print({1: "test2 > (0)::double precision"} == {1: tt("test2 > 0")})
        # assert 0
        materialized = {(schema, "dingalings_v"): []}
        views = {
            (schema, "email_addresses_v"): [],
            (schema, "users_v"): [],
            (schema, "user_tmp_v"): [],
        }
        self._resolve_views(views, materialized)
        tables = {
            (schema, "users"): [
                cc("test2 <= 1000", mock.ANY),
                cc(
                    "test2 > 0",
                    "zz_test2_gt_zero",
                    comment="users check constraint",
                ),
            ],
            (schema, "dingalings"): [
                cc(
                    "address_id > 0 and address_id < 1000",
                    name="address_id_gt_zero",
                ),
            ],
            (schema, "email_addresses"): [],
            (schema, "comment_test"): [],
            (schema, "no_constraints"): [],
            (schema, "local_table"): [],
            (schema, "remote_table"): [],
            (schema, "remote_table_2"): [],
            (schema, "noncol_idx_test_nopk"): [],
            (schema, "noncol_idx_test_pk"): [],
            (schema, self.temp_table_name()): [],
        }
        res = self._resolve_kind(kind, tables, views, materialized)
        res = self._resolve_names(schema, scope, filter_names, res)
        return res

    @property
    def _required_cc_keys(self):
        return {"name", "sqltext"}

    @testing.requires.schema_reflection
    def test_get_schema_names(self, connection):
        insp = inspect(connection)

        is_true(testing.config.test_schema in insp.get_schema_names())

    @testing.requires.schema_reflection
    def test_has_schema(self, connection):
        insp = inspect(connection)

        is_true(insp.has_schema(testing.config.test_schema))
        is_false(insp.has_schema("sa_fake_schema_foo"))

    @testing.requires.schema_reflection
    def test_get_schema_names_w_translate_map(self, connection):
        """test #7300"""

        connection = connection.execution_options(
            schema_translate_map={
                "foo": "bar",
                BLANK_SCHEMA: testing.config.test_schema,
            }
        )
        insp = inspect(connection)

        is_true(testing.config.test_schema in insp.get_schema_names())

    @testing.requires.schema_reflection
    def test_has_schema_w_translate_map(self, connection):
        connection = connection.execution_options(
            schema_translate_map={
                "foo": "bar",
                BLANK_SCHEMA: testing.config.test_schema,
            }
        )
        insp = inspect(connection)

        is_true(insp.has_schema(testing.config.test_schema))
        is_false(insp.has_schema("sa_fake_schema_foo"))

    @testing.requires.schema_reflection
    @testing.requires.schema_create_delete
    def test_schema_cache(self, connection):
        insp = inspect(connection)

        is_false("foo_bar" in insp.get_schema_names())
        is_false(insp.has_schema("foo_bar"))
        connection.execute(DDL("CREATE SCHEMA foo_bar"))
        try:
            is_false("foo_bar" in insp.get_schema_names())
            is_false(insp.has_schema("foo_bar"))
            insp.clear_cache()
            is_true("foo_bar" in insp.get_schema_names())
            is_true(insp.has_schema("foo_bar"))
        finally:
            connection.execute(DDL("DROP SCHEMA foo_bar"))

    @testing.requires.schema_reflection
    def test_dialect_initialize(self):
        engine = engines.testing_engine()
        inspect(engine)
        assert hasattr(engine.dialect, "default_schema_name")

    @testing.requires.schema_reflection
    def test_get_default_schema_name(self, connection):
        insp = inspect(connection)
        eq_(insp.default_schema_name, connection.dialect.default_schema_name)

    @testing.combinations(
        None,
        ("foreign_key", testing.requires.foreign_key_constraint_reflection),
        argnames="order_by",
    )
    @testing.combinations(
        (True, testing.requires.schemas), False, argnames="use_schema"
    )
    def test_get_table_names(self, connection, order_by, use_schema):
        if use_schema:
            schema = config.test_schema
        else:
            schema = None

        _ignore_tables = {
            "comment_test",
            "noncol_idx_test_pk",
            "noncol_idx_test_nopk",
            "local_table",
            "remote_table",
            "remote_table_2",
            "no_constraints",
        }

        insp = inspect(connection)

        if order_by:
            tables = [
                rec[0]
                for rec in insp.get_sorted_table_and_fkc_names(schema)
                if rec[0]
            ]
        else:
            tables = insp.get_table_names(schema)
        table_names = [t for t in tables if t not in _ignore_tables]

        if order_by == "foreign_key":
            answer = ["users", "email_addresses", "dingalings"]
            eq_(table_names, answer)
        else:
            answer = ["dingalings", "email_addresses", "users"]
            eq_(sorted(table_names), answer)

    @testing.combinations(
        (True, testing.requires.schemas), False, argnames="use_schema"
    )
    def test_get_view_names(self, connection, use_schema):
        insp = inspect(connection)
        if use_schema:
            schema = config.test_schema
        else:
            schema = None
        table_names = insp.get_view_names(schema)
        if testing.requires.materialized_views.enabled:
            eq_(sorted(table_names), ["email_addresses_v", "users_v"])
            eq_(insp.get_materialized_view_names(schema), ["dingalings_v"])
        else:
            answer = ["dingalings_v", "email_addresses_v", "users_v"]
            eq_(sorted(table_names), answer)

    @testing.requires.temp_table_names
    def test_get_temp_table_names(self, connection):
        insp = inspect(connection)
        temp_table_names = insp.get_temp_table_names()
        eq_(sorted(temp_table_names), [f"user_tmp_{config.ident}"])

    @testing.requires.view_reflection
    @testing.requires.temporary_views
    def test_get_temp_view_names(self, connection):
        insp = inspect(connection)
        temp_table_names = insp.get_temp_view_names()
        eq_(sorted(temp_table_names), ["user_tmp_v"])

    @testing.requires.comment_reflection
    def test_get_comments(self, connection):
        self._test_get_comments(connection)

    @testing.requires.comment_reflection
    @testing.requires.schemas
    def test_get_comments_with_schema(self, connection):
        self._test_get_comments(connection, testing.config.test_schema)

    def _test_get_comments(self, connection, schema=None):
        insp = inspect(connection)
        exp = self.exp_comments(schema=schema)
        eq_(
            insp.get_table_comment("comment_test", schema=schema),
            exp[(schema, "comment_test")],
        )

        eq_(
            insp.get_table_comment("users", schema=schema),
            exp[(schema, "users")],
        )

        eq_(
            insp.get_table_comment("comment_test", schema=schema),
            exp[(schema, "comment_test")],
        )

        no_cst = self.tables.no_constraints.name
        eq_(
            insp.get_table_comment(no_cst, schema=schema),
            exp[(schema, no_cst)],
        )

    @testing.combinations(
        (False, False),
        (False, True, testing.requires.schemas),
        (True, False, testing.requires.view_reflection),
        (
            True,
            True,
            testing.requires.schemas + testing.requires.view_reflection,
        ),
        argnames="use_views,use_schema",
    )
    def test_get_columns(self, connection, use_views, use_schema):
        if use_schema:
            schema = config.test_schema
        else:
            schema = None

        users, addresses = (self.tables.users, self.tables.email_addresses)
        if use_views:
            table_names = ["users_v", "email_addresses_v", "dingalings_v"]
        else:
            table_names = ["users", "email_addresses"]

        insp = inspect(connection)
        for table_name, table in zip(table_names, (users, addresses)):
            schema_name = schema
            cols = insp.get_columns(table_name, schema=schema_name)
            is_true(len(cols) > 0, len(cols))

            # should be in order

            for i, col in enumerate(table.columns):
                eq_(col.name, cols[i]["name"])
                ctype = cols[i]["type"].__class__
                ctype_def = col.type
                if isinstance(ctype_def, sa.types.TypeEngine):
                    ctype_def = ctype_def.__class__

                # Oracle returns Date for DateTime.

                if testing.against("oracle") and ctype_def in (
                    sql_types.Date,
                    sql_types.DateTime,
                ):
                    ctype_def = sql_types.Date

                # assert that the desired type and return type share
                # a base within one of the generic types.

                is_true(
                    len(
                        set(ctype.__mro__)
                        .intersection(ctype_def.__mro__)
                        .intersection(
                            [
                                sql_types.Integer,
                                sql_types.Numeric,
                                sql_types.DateTime,
                                sql_types.Date,
                                sql_types.Time,
                                sql_types.String,
                                sql_types._Binary,
                            ]
                        )
                    )
                    > 0,
                    "%s(%s), %s(%s)"
                    % (col.name, col.type, cols[i]["name"], ctype),
                )

                if not col.primary_key:
                    assert cols[i]["default"] is None

        # The case of a table with no column
        # is tested below in TableNoColumnsTest

    @testing.requires.temp_table_reflection
    def test_reflect_table_temp_table(self, connection):
        table_name = self.temp_table_name()
        user_tmp = self.tables[table_name]

        reflected_user_tmp = Table(
            table_name, MetaData(), autoload_with=connection
        )
        self.assert_tables_equal(
            user_tmp, reflected_user_tmp, strict_constraints=False
        )

    @testing.requires.temp_table_reflection
    def test_get_temp_table_columns(self, connection):
        table_name = self.temp_table_name()
        user_tmp = self.tables[table_name]
        insp = inspect(connection)
        cols = insp.get_columns(table_name)
        is_true(len(cols) > 0, len(cols))

        for i, col in enumerate(user_tmp.columns):
            eq_(col.name, cols[i]["name"])

    @testing.requires.temp_table_reflection
    @testing.requires.view_column_reflection
    @testing.requires.temporary_views
    def test_get_temp_view_columns(self, connection):
        insp = inspect(connection)
        cols = insp.get_columns("user_tmp_v")
        eq_([col["name"] for col in cols], ["id", "name", "foo"])

    @testing.combinations(
        (False,), (True, testing.requires.schemas), argnames="use_schema"
    )
    @testing.requires.primary_key_constraint_reflection
    def test_get_pk_constraint(self, connection, use_schema):
        if use_schema:
            schema = testing.config.test_schema
        else:
            schema = None

        users, addresses = self.tables.users, self.tables.email_addresses
        insp = inspect(connection)
        exp = self.exp_pks(schema=schema)

        users_cons = insp.get_pk_constraint(users.name, schema=schema)
        self._check_list(
            [users_cons], [exp[(schema, users.name)]], self._required_pk_keys
        )

        addr_cons = insp.get_pk_constraint(addresses.name, schema=schema)
        exp_cols = exp[(schema, addresses.name)]["constrained_columns"]
        eq_(addr_cons["constrained_columns"], exp_cols)

        with testing.requires.reflects_pk_names.fail_if():
            eq_(addr_cons["name"], "email_ad_pk")

        no_cst = self.tables.no_constraints.name
        self._check_list(
            [insp.get_pk_constraint(no_cst, schema=schema)],
            [exp[(schema, no_cst)]],
            self._required_pk_keys,
        )

    @testing.combinations(
        (False,), (True, testing.requires.schemas), argnames="use_schema"
    )
    @testing.requires.foreign_key_constraint_reflection
    def test_get_foreign_keys(self, connection, use_schema):
        if use_schema:
            schema = config.test_schema
        else:
            schema = None

        users, addresses = (self.tables.users, self.tables.email_addresses)
        insp = inspect(connection)
        expected_schema = schema
        # users

        if testing.requires.self_referential_foreign_keys.enabled:
            users_fkeys = insp.get_foreign_keys(users.name, schema=schema)
            fkey1 = users_fkeys[0]

            with testing.requires.named_constraints.fail_if():
                eq_(fkey1["name"], "user_id_fk")

            eq_(fkey1["referred_schema"], expected_schema)
            eq_(fkey1["referred_table"], users.name)
            eq_(fkey1["referred_columns"], ["user_id"])
            eq_(fkey1["constrained_columns"], ["parent_user_id"])

        # addresses
        addr_fkeys = insp.get_foreign_keys(addresses.name, schema=schema)
        fkey1 = addr_fkeys[0]

        with testing.requires.implicitly_named_constraints.fail_if():
            is_true(fkey1["name"] is not None)

        eq_(fkey1["referred_schema"], expected_schema)
        eq_(fkey1["referred_table"], users.name)
        eq_(fkey1["referred_columns"], ["user_id"])
        eq_(fkey1["constrained_columns"], ["remote_user_id"])

        no_cst = self.tables.no_constraints.name
        eq_(insp.get_foreign_keys(no_cst, schema=schema), [])

    @testing.requires.cross_schema_fk_reflection
    @testing.requires.schemas
    def test_get_inter_schema_foreign_keys(self, connection):
        local_table, remote_table, remote_table_2 = self.tables(
            "%s.local_table" % connection.dialect.default_schema_name,
            "%s.remote_table" % testing.config.test_schema,
            "%s.remote_table_2" % testing.config.test_schema,
        )

        insp = inspect(connection)

        local_fkeys = insp.get_foreign_keys(local_table.name)
        eq_(len(local_fkeys), 1)

        fkey1 = local_fkeys[0]
        eq_(fkey1["referred_schema"], testing.config.test_schema)
        eq_(fkey1["referred_table"], remote_table_2.name)
        eq_(fkey1["referred_columns"], ["id"])
        eq_(fkey1["constrained_columns"], ["remote_id"])

        remote_fkeys = insp.get_foreign_keys(
            remote_table.name, schema=testing.config.test_schema
        )
        eq_(len(remote_fkeys), 1)

        fkey2 = remote_fkeys[0]

        is_true(
            fkey2["referred_schema"]
            in (
                None,
                connection.dialect.default_schema_name,
            )
        )
        eq_(fkey2["referred_table"], local_table.name)
        eq_(fkey2["referred_columns"], ["id"])
        eq_(fkey2["constrained_columns"], ["local_id"])

    @testing.combinations(
        (False,), (True, testing.requires.schemas), argnames="use_schema"
    )
    @testing.requires.index_reflection
    def test_get_indexes(self, connection, use_schema):
        if use_schema:
            schema = config.test_schema
        else:
            schema = None

        # The database may decide to create indexes for foreign keys, etc.
        # so there may be more indexes than expected.
        insp = inspect(connection)
        indexes = insp.get_indexes("users", schema=schema)
        exp = self.exp_indexes(schema=schema)
        self._check_list(
            indexes, exp[(schema, "users")], self._required_index_keys
        )

        no_cst = self.tables.no_constraints.name
        self._check_list(
            insp.get_indexes(no_cst, schema=schema),
            exp[(schema, no_cst)],
            self._required_index_keys,
        )

    @testing.combinations(
        ("noncol_idx_test_nopk", "noncol_idx_nopk"),
        ("noncol_idx_test_pk", "noncol_idx_pk"),
        argnames="tname,ixname",
    )
    @testing.requires.index_reflection
    @testing.requires.indexes_with_ascdesc
    @testing.requires.reflect_indexes_with_ascdesc
    def test_get_noncol_index(self, connection, tname, ixname):
        insp = inspect(connection)
        indexes = insp.get_indexes(tname)
        # reflecting an index that has "x DESC" in it as the column.
        # the DB may or may not give us "x", but make sure we get the index
        # back, it has a name, it's connected to the table.
        expected_indexes = self.exp_indexes()[(None, tname)]
        self._check_list(indexes, expected_indexes, self._required_index_keys)

        t = Table(tname, MetaData(), autoload_with=connection)
        eq_(len(t.indexes), 1)
        is_(list(t.indexes)[0].table, t)
        eq_(list(t.indexes)[0].name, ixname)

    @testing.requires.temp_table_reflection
    @testing.requires.unique_constraint_reflection
    def test_get_temp_table_unique_constraints(self, connection):
        insp = inspect(connection)
        name = self.temp_table_name()
        reflected = insp.get_unique_constraints(name)
        exp = self.exp_ucs(all_=True)[(None, name)]
        self._check_list(reflected, exp, self._required_index_keys)

    @testing.requires.temp_table_reflect_indexes
    def test_get_temp_table_indexes(self, connection):
        insp = inspect(connection)
        table_name = self.temp_table_name()
        indexes = insp.get_indexes(table_name)
        for ind in indexes:
            ind.pop("dialect_options", None)
        expected = [
            {"unique": False, "column_names": ["foo"], "name": "user_tmp_ix"}
        ]
        if testing.requires.index_reflects_included_columns.enabled:
            expected[0]["include_columns"] = []
        eq_(
            [idx for idx in indexes if idx["name"] == "user_tmp_ix"],
            expected,
        )

    @testing.combinations(
        (True, testing.requires.schemas), (False,), argnames="use_schema"
    )
    @testing.requires.unique_constraint_reflection
    def test_get_unique_constraints(self, metadata, connection, use_schema):
        # SQLite dialect needs to parse the names of the constraints
        # separately from what it gets from PRAGMA index_list(), and
        # then matches them up.  so same set of column_names in two
        # constraints will confuse it.    Perhaps we should no longer
        # bother with index_list() here since we have the whole
        # CREATE TABLE?

        if use_schema:
            schema = config.test_schema
        else:
            schema = None
        uniques = sorted(
            [
                {"name": "unique_a", "column_names": ["a"]},
                {"name": "unique_a_b_c", "column_names": ["a", "b", "c"]},
                {"name": "unique_c_a_b", "column_names": ["c", "a", "b"]},
                {"name": "unique_asc_key", "column_names": ["asc", "key"]},
                {"name": "i.have.dots", "column_names": ["b"]},
                {"name": "i have spaces", "column_names": ["c"]},
            ],
            key=operator.itemgetter("name"),
        )
        table = Table(
            "testtbl",
            metadata,
            Column("a", sa.String(20)),
            Column("b", sa.String(30)),
            Column("c", sa.Integer),
            # reserved identifiers
            Column("asc", sa.String(30)),
            Column("key", sa.String(30)),
            schema=schema,
        )
        for uc in uniques:
            table.append_constraint(
                sa.UniqueConstraint(*uc["column_names"], name=uc["name"])
            )
        table.create(connection)

        insp = inspect(connection)
        reflected = sorted(
            insp.get_unique_constraints("testtbl", schema=schema),
            key=operator.itemgetter("name"),
        )

        names_that_duplicate_index = set()

        eq_(len(uniques), len(reflected))

        for orig, refl in zip(uniques, reflected):
            # Different dialects handle duplicate index and constraints
            # differently, so ignore this flag
            dupe = refl.pop("duplicates_index", None)
            if dupe:
                names_that_duplicate_index.add(dupe)
            eq_(refl.pop("comment", None), None)
            eq_(orig, refl)

        reflected_metadata = MetaData()
        reflected = Table(
            "testtbl",
            reflected_metadata,
            autoload_with=connection,
            schema=schema,
        )

        # test "deduplicates for index" logic.   MySQL and Oracle
        # "unique constraints" are actually unique indexes (with possible
        # exception of a unique that is a dupe of another one in the case
        # of Oracle).  make sure # they aren't duplicated.
        idx_names = {idx.name for idx in reflected.indexes}
        uq_names = {
            uq.name
            for uq in reflected.constraints
            if isinstance(uq, sa.UniqueConstraint)
        }.difference(["unique_c_a_b"])

        assert not idx_names.intersection(uq_names)
        if names_that_duplicate_index:
            eq_(names_that_duplicate_index, idx_names)
            eq_(uq_names, set())

        no_cst = self.tables.no_constraints.name
        eq_(insp.get_unique_constraints(no_cst, schema=schema), [])

    @testing.requires.view_reflection
    @testing.combinations(
        (False,), (True, testing.requires.schemas), argnames="use_schema"
    )
    def test_get_view_definition(self, connection, use_schema):
        if use_schema:
            schema = config.test_schema
        else:
            schema = None
        insp = inspect(connection)
        for view in ["users_v", "email_addresses_v", "dingalings_v"]:
            v = insp.get_view_definition(view, schema=schema)
            is_true(bool(v))

    @testing.requires.view_reflection
    def test_get_view_definition_does_not_exist(self, connection):
        insp = inspect(connection)
        with expect_raises(NoSuchTableError):
            insp.get_view_definition("view_does_not_exist")
        with expect_raises(NoSuchTableError):
            insp.get_view_definition("users")  # a table

    @testing.requires.table_reflection
    def test_autoincrement_col(self, connection):
        """test that 'autoincrement' is reflected according to sqla's policy.

        Don't mark this test as unsupported for any backend !

        (technically it fails with MySQL InnoDB since "id" comes before "id2")

        A backend is better off not returning "autoincrement" at all,
        instead of potentially returning "False" for an auto-incrementing
        primary key column.

        """

        insp = inspect(connection)

        for tname, cname in [
            ("users", "user_id"),
            ("email_addresses", "address_id"),
            ("dingalings", "dingaling_id"),
        ]:
            cols = insp.get_columns(tname)
            id_ = {c["name"]: c for c in cols}[cname]
            assert id_.get("autoincrement", True)

    @testing.combinations(
        (True, testing.requires.schemas), (False,), argnames="use_schema"
    )
    def test_get_table_options(self, use_schema):
        insp = inspect(config.db)
        schema = config.test_schema if use_schema else None

        if testing.requires.reflect_table_options.enabled:
            res = insp.get_table_options("users", schema=schema)
            is_true(isinstance(res, dict))
            # NOTE: can't really create a table with no option
            res = insp.get_table_options("no_constraints", schema=schema)
            is_true(isinstance(res, dict))
        else:
            with expect_raises(NotImplementedError):
                res = insp.get_table_options("users", schema=schema)

    @testing.combinations((True, testing.requires.schemas), False)
    def test_multi_get_table_options(self, use_schema):
        insp = inspect(config.db)
        if testing.requires.reflect_table_options.enabled:
            schema = config.test_schema if use_schema else None
            res = insp.get_multi_table_options(schema=schema)

            exp = {
                (schema, table): insp.get_table_options(table, schema=schema)
                for table in insp.get_table_names(schema=schema)
            }
            eq_(res, exp)
        else:
            with expect_raises(NotImplementedError):
                res = insp.get_multi_table_options()

    @testing.fixture
    def get_multi_exp(self, connection):
        def provide_fixture(
            schema, scope, kind, use_filter, single_reflect_fn, exp_method
        ):
            insp = inspect(connection)
            # call the reflection function at least once to avoid
            # "Unexpected success" errors if the result is actually empty
            # and NotImplementedError is not raised
            single_reflect_fn(insp, "email_addresses")
            kw = {"scope": scope, "kind": kind}
            if schema:
                schema = schema()

            filter_names = []

            if ObjectKind.TABLE in kind:
                filter_names.extend(
                    ["comment_test", "users", "does-not-exist"]
                )
            if ObjectKind.VIEW in kind:
                filter_names.extend(["email_addresses_v", "does-not-exist"])
            if ObjectKind.MATERIALIZED_VIEW in kind:
                filter_names.extend(["dingalings_v", "does-not-exist"])

            if schema:
                kw["schema"] = schema
            if use_filter:
                kw["filter_names"] = filter_names

            exp = exp_method(
                schema=schema,
                scope=scope,
                kind=kind,
                filter_names=kw.get("filter_names"),
            )
            kws = [kw]
            if scope == ObjectScope.DEFAULT:
                nkw = kw.copy()
                nkw.pop("scope")
                kws.append(nkw)
            if kind == ObjectKind.TABLE:
                nkw = kw.copy()
                nkw.pop("kind")
                kws.append(nkw)

            return inspect(connection), kws, exp

        return provide_fixture

    @testing.requires.reflect_table_options
    @_multi_combination
    def test_multi_get_table_options_tables(
        self, get_multi_exp, schema, scope, kind, use_filter
    ):
        insp, kws, exp = get_multi_exp(
            schema,
            scope,
            kind,
            use_filter,
            Inspector.get_table_options,
            self.exp_options,
        )
        for kw in kws:
            insp.clear_cache()
            result = insp.get_multi_table_options(**kw)
            eq_(result, exp)

    @testing.requires.comment_reflection
    @_multi_combination
    def test_get_multi_table_comment(
        self, get_multi_exp, schema, scope, kind, use_filter
    ):
        insp, kws, exp = get_multi_exp(
            schema,
            scope,
            kind,
            use_filter,
            Inspector.get_table_comment,
            self.exp_comments,
        )
        for kw in kws:
            insp.clear_cache()
            eq_(insp.get_multi_table_comment(**kw), exp)

    def _check_expressions(self, result, exp, err_msg):
        def _clean(text: str):
            return re.sub(r"['\" ]", "", text).lower()

        if isinstance(exp, dict):
            eq_({_clean(e): v for e, v in result.items()}, exp, err_msg)
        else:
            eq_([_clean(e) for e in result], exp, err_msg)

    def _check_list(self, result, exp, req_keys=None, msg=None):
        if req_keys is None:
            eq_(result, exp, msg)
        else:
            eq_(len(result), len(exp), msg)
            for r, e in zip(result, exp):
                for k in set(r) | set(e):
                    if k in req_keys or (k in r and k in e):
                        err_msg = f"{msg} - {k} - {r}"
                        if k in ("expressions", "column_sorting"):
                            self._check_expressions(r[k], e[k], err_msg)
                        else:
                            eq_(r[k], e[k], err_msg)

    def _check_table_dict(self, result, exp, req_keys=None, make_lists=False):
        eq_(set(result.keys()), set(exp.keys()))
        for k in result:
            r, e = result[k], exp[k]
            if make_lists:
                r, e = [r], [e]
            self._check_list(r, e, req_keys, k)

    @_multi_combination
    def test_get_multi_columns(
        self, get_multi_exp, schema, scope, kind, use_filter
    ):
        insp, kws, exp = get_multi_exp(
            schema,
            scope,
            kind,
            use_filter,
            Inspector.get_columns,
            self.exp_columns,
        )

        for kw in kws:
            insp.clear_cache()
            result = insp.get_multi_columns(**kw)
            self._check_table_dict(result, exp, self._required_column_keys)

    @testing.requires.primary_key_constraint_reflection
    @_multi_combination
    def test_get_multi_pk_constraint(
        self, get_multi_exp, schema, scope, kind, use_filter
    ):
        insp, kws, exp = get_multi_exp(
            schema,
            scope,
            kind,
            use_filter,
            Inspector.get_pk_constraint,
            self.exp_pks,
        )
        for kw in kws:
            insp.clear_cache()
            result = insp.get_multi_pk_constraint(**kw)
            self._check_table_dict(
                result, exp, self._required_pk_keys, make_lists=True
            )

    def _adjust_sort(self, result, expected, key):
        if not testing.requires.implicitly_named_constraints.enabled:
            for obj in [result, expected]:
                for val in obj.values():
                    if len(val) > 1 and any(
                        v.get("name") in (None, mock.ANY) for v in val
                    ):
                        val.sort(key=key)

    @testing.requires.foreign_key_constraint_reflection
    @_multi_combination
    def test_get_multi_foreign_keys(
        self, get_multi_exp, schema, scope, kind, use_filter
    ):
        insp, kws, exp = get_multi_exp(
            schema,
            scope,
            kind,
            use_filter,
            Inspector.get_foreign_keys,
            self.exp_fks,
        )
        for kw in kws:
            insp.clear_cache()
            result = insp.get_multi_foreign_keys(**kw)
            self._adjust_sort(
                result, exp, lambda d: tuple(d["constrained_columns"])
            )
            self._check_table_dict(result, exp, self._required_fk_keys)

    @testing.requires.index_reflection
    @_multi_combination
    def test_get_multi_indexes(
        self, get_multi_exp, schema, scope, kind, use_filter
    ):
        insp, kws, exp = get_multi_exp(
            schema,
            scope,
            kind,
            use_filter,
            Inspector.get_indexes,
            self.exp_indexes,
        )
        for kw in kws:
            insp.clear_cache()
            result = insp.get_multi_indexes(**kw)
            self._check_table_dict(result, exp, self._required_index_keys)

    @testing.requires.unique_constraint_reflection
    @_multi_combination
    def test_get_multi_unique_constraints(
        self, get_multi_exp, schema, scope, kind, use_filter
    ):
        insp, kws, exp = get_multi_exp(
            schema,
            scope,
            kind,
            use_filter,
            Inspector.get_unique_constraints,
            self.exp_ucs,
        )
        for kw in kws:
            insp.clear_cache()
            result = insp.get_multi_unique_constraints(**kw)
            self._adjust_sort(result, exp, lambda d: tuple(d["column_names"]))
            self._check_table_dict(result, exp, self._required_unique_cst_keys)

    @testing.requires.check_constraint_reflection
    @_multi_combination
    def test_get_multi_check_constraints(
        self, get_multi_exp, schema, scope, kind, use_filter
    ):
        insp, kws, exp = get_multi_exp(
            schema,
            scope,
            kind,
            use_filter,
            Inspector.get_check_constraints,
            self.exp_ccs,
        )
        for kw in kws:
            insp.clear_cache()
            result = insp.get_multi_check_constraints(**kw)
            self._adjust_sort(result, exp, lambda d: tuple(d["sqltext"]))
            self._check_table_dict(result, exp, self._required_cc_keys)

    @testing.combinations(
        ("get_table_options", testing.requires.reflect_table_options),
        "get_columns",
        (
            "get_pk_constraint",
            testing.requires.primary_key_constraint_reflection,
        ),
        (
            "get_foreign_keys",
            testing.requires.foreign_key_constraint_reflection,
        ),
        ("get_indexes", testing.requires.index_reflection),
        (
            "get_unique_constraints",
            testing.requires.unique_constraint_reflection,
        ),
        (
            "get_check_constraints",
            testing.requires.check_constraint_reflection,
        ),
        ("get_table_comment", testing.requires.comment_reflection),
        argnames="method",
    )
    def test_not_existing_table(self, method, connection):
        insp = inspect(connection)
        meth = getattr(insp, method)
        with expect_raises(NoSuchTableError):
            meth("table_does_not_exists")

    def test_unreflectable(self, connection):
        mc = Inspector.get_multi_columns

        def patched(*a, **k):
            ur = k.setdefault("unreflectable", {})
            ur[(None, "some_table")] = UnreflectableTableError("err")
            return mc(*a, **k)

        with mock.patch.object(Inspector, "get_multi_columns", patched):
            with expect_raises_message(UnreflectableTableError, "err"):
                inspect(connection).reflect_table(
                    Table("some_table", MetaData()), None
                )

    @testing.combinations(True, False, argnames="use_schema")
    @testing.combinations(
        (True, testing.requires.views), False, argnames="views"
    )
    def test_metadata(self, connection, use_schema, views):
        m = MetaData()
        schema = config.test_schema if use_schema else None
        m.reflect(connection, schema=schema, views=views, resolve_fks=False)

        insp = inspect(connection)
        tables = insp.get_table_names(schema)
        if views:
            tables += insp.get_view_names(schema)
            try:
                tables += insp.get_materialized_view_names(schema)
            except NotImplementedError:
                pass
        if schema:
            tables = [f"{schema}.{t}" for t in tables]
        eq_(sorted(m.tables), sorted(tables))

    @testing.requires.comment_reflection
    def test_comments_unicode(self, connection, metadata):
        Table(
            "unicode_comments",
            metadata,
            Column("unicode", Integer, comment="é試蛇ẟΩ"),
            Column("emoji", Integer, comment="☁️✨"),
            comment="試蛇ẟΩ✨",
        )

        metadata.create_all(connection)

        insp = inspect(connection)
        tc = insp.get_table_comment("unicode_comments")
        eq_(tc, {"text": "試蛇ẟΩ✨"})

        cols = insp.get_columns("unicode_comments")
        value = {c["name"]: c["comment"] for c in cols}
        exp = {"unicode": "é試蛇ẟΩ", "emoji": "☁️✨"}
        eq_(value, exp)

    @testing.requires.comment_reflection_full_unicode
    def test_comments_unicode_full(self, connection, metadata):
        Table(
            "unicode_comments",
            metadata,
            Column("emoji", Integer, comment="🐍🧙🝝🧙‍♂️🧙‍♀️"),
            comment="🎩🁰🝑🤷‍♀️🤷‍♂️",
        )

        metadata.create_all(connection)

        insp = inspect(connection)
        tc = insp.get_table_comment("unicode_comments")
        eq_(tc, {"text": "🎩🁰🝑🤷‍♀️🤷‍♂️"})
        c = insp.get_columns("unicode_comments")[0]
        eq_({c["name"]: c["comment"]}, {"emoji": "🐍🧙🝝🧙‍♂️🧙‍♀️"})


class TableNoColumnsTest(fixtures.TestBase):
    __requires__ = ("reflect_tables_no_columns",)
    __backend__ = True

    @testing.fixture
    def table_no_columns(self, connection, metadata):
        Table("empty", metadata)
        metadata.create_all(connection)

    @testing.fixture
    def view_no_columns(self, connection, metadata):
        Table("empty", metadata)
        event.listen(
            metadata,
            "after_create",
            DDL("CREATE VIEW empty_v AS SELECT * FROM empty"),
        )

        # for transactional DDL the transaction is rolled back before this
        # drop statement is invoked
        event.listen(
            metadata, "before_drop", DDL("DROP VIEW IF EXISTS empty_v")
        )
        metadata.create_all(connection)

    def test_reflect_table_no_columns(self, connection, table_no_columns):
        t2 = Table("empty", MetaData(), autoload_with=connection)
        eq_(list(t2.c), [])

    def test_get_columns_table_no_columns(self, connection, table_no_columns):
        insp = inspect(connection)
        eq_(insp.get_columns("empty"), [])
        multi = insp.get_multi_columns()
        eq_(multi, {(None, "empty"): []})

    def test_reflect_incl_table_no_columns(self, connection, table_no_columns):
        m = MetaData()
        m.reflect(connection)
        assert set(m.tables).intersection(["empty"])

    @testing.requires.views
    def test_reflect_view_no_columns(self, connection, view_no_columns):
        t2 = Table("empty_v", MetaData(), autoload_with=connection)
        eq_(list(t2.c), [])

    @testing.requires.views
    def test_get_columns_view_no_columns(self, connection, view_no_columns):
        insp = inspect(connection)
        eq_(insp.get_columns("empty_v"), [])
        multi = insp.get_multi_columns(kind=ObjectKind.VIEW)
        eq_(multi, {(None, "empty_v"): []})


class ComponentReflectionTestExtra(ComparesIndexes, fixtures.TestBase):
    __backend__ = True

    @testing.combinations(
        (True, testing.requires.schemas), (False,), argnames="use_schema"
    )
    @testing.requires.check_constraint_reflection
    def test_get_check_constraints(self, metadata, connection, use_schema):
        if use_schema:
            schema = config.test_schema
        else:
            schema = None

        Table(
            "sa_cc",
            metadata,
            Column("a", Integer()),
            sa.CheckConstraint("a > 1 AND a < 5", name="cc1"),
            sa.CheckConstraint(
                "a = 1 OR (a > 2 AND a < 5)", name="UsesCasing"
            ),
            schema=schema,
        )
        Table(
            "no_constraints",
            metadata,
            Column("data", sa.String(20)),
            schema=schema,
        )

        metadata.create_all(connection)

        insp = inspect(connection)
        reflected = sorted(
            insp.get_check_constraints("sa_cc", schema=schema),
            key=operator.itemgetter("name"),
        )

        # trying to minimize effect of quoting, parenthesis, etc.
        # may need to add more to this as new dialects get CHECK
        # constraint reflection support
        def normalize(sqltext):
            return " ".join(
                re.findall(r"and|\d|=|a|or|<|>", sqltext.lower(), re.I)
            )

        reflected = [
            {"name": item["name"], "sqltext": normalize(item["sqltext"])}
            for item in reflected
        ]
        eq_(
            reflected,
            [
                {"name": "UsesCasing", "sqltext": "a = 1 or a > 2 and a < 5"},
                {"name": "cc1", "sqltext": "a > 1 and a < 5"},
            ],
        )
        no_cst = "no_constraints"
        eq_(insp.get_check_constraints(no_cst, schema=schema), [])

    @testing.requires.indexes_with_expressions
    def test_reflect_expression_based_indexes(self, metadata, connection):
        t = Table(
            "t",
            metadata,
            Column("x", String(30)),
            Column("y", String(30)),
            Column("z", String(30)),
        )

        Index("t_idx", func.lower(t.c.x), t.c.z, func.lower(t.c.y))
        long_str = "long string " * 100
        Index("t_idx_long", func.coalesce(t.c.x, long_str))
        Index("t_idx_2", t.c.x)

        metadata.create_all(connection)

        insp = inspect(connection)

        expected = [
            {
                "name": "t_idx_2",
                "column_names": ["x"],
                "unique": False,
                "dialect_options": {},
            }
        ]

        def completeIndex(entry):
            if testing.requires.index_reflects_included_columns.enabled:
                entry["include_columns"] = []
                entry["dialect_options"] = {
                    f"{connection.engine.name}_include": []
                }
            else:
                entry.setdefault("dialect_options", {})

        completeIndex(expected[0])

        class lower_index_str(str):
            def __eq__(self, other):
                ol = other.lower()
                # test that lower and x or y are in the string
                return "lower" in ol and ("x" in ol or "y" in ol)

        class coalesce_index_str(str):
            def __eq__(self, other):
                # test that coalesce and the string is in other
                return "coalesce" in other.lower() and long_str in other

        if testing.requires.reflect_indexes_with_expressions.enabled:
            expr_index = {
                "name": "t_idx",
                "column_names": [None, "z", None],
                "expressions": [
                    lower_index_str("lower(x)"),
                    "z",
                    lower_index_str("lower(y)"),
                ],
                "unique": False,
            }
            completeIndex(expr_index)
            expected.insert(0, expr_index)

            expr_index_long = {
                "name": "t_idx_long",
                "column_names": [None],
                "expressions": [
                    coalesce_index_str(f"coalesce(x, '{long_str}')")
                ],
                "unique": False,
            }
            completeIndex(expr_index_long)
            expected.append(expr_index_long)

            eq_(insp.get_indexes("t"), expected)
            m2 = MetaData()
            t2 = Table("t", m2, autoload_with=connection)
        else:
            with expect_warnings(
                "Skipped unsupported reflection of expression-based "
                "index t_idx"
            ):
                eq_(insp.get_indexes("t"), expected)
                m2 = MetaData()
                t2 = Table("t", m2, autoload_with=connection)

        self.compare_table_index_with_expected(
            t2, expected, connection.engine.name
        )

    @testing.requires.index_reflects_included_columns
    def test_reflect_covering_index(self, metadata, connection):
        t = Table(
            "t",
            metadata,
            Column("x", String(30)),
            Column("y", String(30)),
        )
        idx = Index("t_idx", t.c.x)
        idx.dialect_options[connection.engine.name]["include"] = ["y"]

        metadata.create_all(connection)

        insp = inspect(connection)

        get_indexes = insp.get_indexes("t")
        eq_(
            get_indexes,
            [
                {
                    "name": "t_idx",
                    "column_names": ["x"],
                    "include_columns": ["y"],
                    "unique": False,
                    "dialect_options": mock.ANY,
                }
            ],
        )
        eq_(
            get_indexes[0]["dialect_options"][
                "%s_include" % connection.engine.name
            ],
            ["y"],
        )

        t2 = Table("t", MetaData(), autoload_with=connection)
        eq_(
            list(t2.indexes)[0].dialect_options[connection.engine.name][
                "include"
            ],
            ["y"],
        )

    def _type_round_trip(self, connection, metadata, *types):
        t = Table(
            "t",
            metadata,
            *[Column("t%d" % i, type_) for i, type_ in enumerate(types)],
        )
        t.create(connection)

        return [c["type"] for c in inspect(connection).get_columns("t")]

    @testing.requires.table_reflection
    def test_numeric_reflection(self, connection, metadata):
        for typ in self._type_round_trip(
            connection, metadata, sql_types.Numeric(18, 5)
        ):
            assert isinstance(typ, sql_types.Numeric)
            eq_(typ.precision, 18)
            eq_(typ.scale, 5)

    @testing.requires.table_reflection
    def test_varchar_reflection(self, connection, metadata):
        typ = self._type_round_trip(
            connection, metadata, sql_types.String(52)
        )[0]
        assert isinstance(typ, sql_types.String)
        eq_(typ.length, 52)

    @testing.requires.table_reflection
    def test_nullable_reflection(self, connection, metadata):
        t = Table(
            "t",
            metadata,
            Column("a", Integer, nullable=True),
            Column("b", Integer, nullable=False),
        )
        t.create(connection)
        eq_(
            {
                col["name"]: col["nullable"]
                for col in inspect(connection).get_columns("t")
            },
            {"a": True, "b": False},
        )

    @testing.combinations(
        (
            None,
            "CASCADE",
            None,
            testing.requires.foreign_key_constraint_option_reflection_ondelete,
        ),
        (
            None,
            None,
            "SET NULL",
            testing.requires.foreign_key_constraint_option_reflection_onupdate,
        ),
        (
            {},
            None,
            "NO ACTION",
            testing.requires.foreign_key_constraint_option_reflection_onupdate,
        ),
        (
            {},
            "NO ACTION",
            None,
            testing.requires.fk_constraint_option_reflection_ondelete_noaction,
        ),
        (
            None,
            None,
            "RESTRICT",
            testing.requires.fk_constraint_option_reflection_onupdate_restrict,
        ),
        (
            None,
            "RESTRICT",
            None,
            testing.requires.fk_constraint_option_reflection_ondelete_restrict,
        ),
        argnames="expected,ondelete,onupdate",
    )
    def test_get_foreign_key_options(
        self, connection, metadata, expected, ondelete, onupdate
    ):
        options = {}
        if ondelete:
            options["ondelete"] = ondelete
        if onupdate:
            options["onupdate"] = onupdate

        if expected is None:
            expected = options

        Table(
            "x",
            metadata,
            Column("id", Integer, primary_key=True),
            test_needs_fk=True,
        )

        Table(
            "table",
            metadata,
            Column("id", Integer, primary_key=True),
            Column("x_id", Integer, ForeignKey("x.id", name="xid")),
            Column("test", String(10)),
            test_needs_fk=True,
        )

        Table(
            "user",
            metadata,
            Column("id", Integer, primary_key=True),
            Column("name", String(50), nullable=False),
            Column("tid", Integer),
            sa.ForeignKeyConstraint(
                ["tid"], ["table.id"], name="myfk", **options
            ),
            test_needs_fk=True,
        )

        metadata.create_all(connection)

        insp = inspect(connection)

        # test 'options' is always present for a backend
        # that can reflect these, since alembic looks for this
        opts = insp.get_foreign_keys("table")[0]["options"]

        eq_({k: opts[k] for k in opts if opts[k]}, {})

        opts = insp.get_foreign_keys("user")[0]["options"]
        eq_(opts, expected)
        # eq_(dict((k, opts[k]) for k in opts if opts[k]), expected)


class NormalizedNameTest(fixtures.TablesTest):
    __requires__ = ("denormalized_names",)
    __backend__ = True

    @classmethod
    def define_tables(cls, metadata):
        Table(
            quoted_name("t1", quote=True),
            metadata,
            Column("id", Integer, primary_key=True),
        )
        Table(
            quoted_name("t2", quote=True),
            metadata,
            Column("id", Integer, primary_key=True),
            Column("t1id", ForeignKey("t1.id")),
        )

    def test_reflect_lowercase_forced_tables(self):
        m2 = MetaData()
        t2_ref = Table(
            quoted_name("t2", quote=True), m2, autoload_with=config.db
        )
        t1_ref = m2.tables["t1"]
        assert t2_ref.c.t1id.references(t1_ref.c.id)

        m3 = MetaData()
        m3.reflect(
            config.db, only=lambda name, m: name.lower() in ("t1", "t2")
        )
        assert m3.tables["t2"].c.t1id.references(m3.tables["t1"].c.id)

    def test_get_table_names(self):
        tablenames = [
            t
            for t in inspect(config.db).get_table_names()
            if t.lower() in ("t1", "t2")
        ]

        eq_(tablenames[0].upper(), tablenames[0].lower())
        eq_(tablenames[1].upper(), tablenames[1].lower())


class ComputedReflectionTest(fixtures.ComputedReflectionFixtureTest):
    def test_computed_col_default_not_set(self):
        insp = inspect(config.db)

        cols = insp.get_columns("computed_default_table")
        col_data = {c["name"]: c for c in cols}
        is_true("42" in col_data["with_default"]["default"])
        is_(col_data["normal"]["default"], None)
        is_(col_data["computed_col"]["default"], None)

    def test_get_column_returns_computed(self):
        insp = inspect(config.db)

        cols = insp.get_columns("computed_default_table")
        data = {c["name"]: c for c in cols}
        for key in ("id", "normal", "with_default"):
            is_true("computed" not in data[key])
        compData = data["computed_col"]
        is_true("computed" in compData)
        is_true("sqltext" in compData["computed"])
        eq_(self.normalize(compData["computed"]["sqltext"]), "normal+42")
        eq_(
            "persisted" in compData["computed"],
            testing.requires.computed_columns_reflect_persisted.enabled,
        )
        if testing.requires.computed_columns_reflect_persisted.enabled:
            eq_(
                compData["computed"]["persisted"],
                testing.requires.computed_columns_default_persisted.enabled,
            )

    def check_column(self, data, column, sqltext, persisted):
        is_true("computed" in data[column])
        compData = data[column]["computed"]
        eq_(self.normalize(compData["sqltext"]), sqltext)
        if testing.requires.computed_columns_reflect_persisted.enabled:
            is_true("persisted" in compData)
            is_(compData["persisted"], persisted)

    def test_get_column_returns_persisted(self):
        insp = inspect(config.db)

        cols = insp.get_columns("computed_column_table")
        data = {c["name"]: c for c in cols}

        self.check_column(
            data,
            "computed_no_flag",
            "normal+42",
            testing.requires.computed_columns_default_persisted.enabled,
        )
        if testing.requires.computed_columns_virtual.enabled:
            self.check_column(
                data,
                "computed_virtual",
                "normal+2",
                False,
            )
        if testing.requires.computed_columns_stored.enabled:
            self.check_column(
                data,
                "computed_stored",
                "normal-42",
                True,
            )

    @testing.requires.schemas
    def test_get_column_returns_persisted_with_schema(self):
        insp = inspect(config.db)

        cols = insp.get_columns(
            "computed_column_table", schema=config.test_schema
        )
        data = {c["name"]: c for c in cols}

        self.check_column(
            data,
            "computed_no_flag",
            "normal/42",
            testing.requires.computed_columns_default_persisted.enabled,
        )
        if testing.requires.computed_columns_virtual.enabled:
            self.check_column(
                data,
                "computed_virtual",
                "normal/2",
                False,
            )
        if testing.requires.computed_columns_stored.enabled:
            self.check_column(
                data,
                "computed_stored",
                "normal*42",
                True,
            )


class IdentityReflectionTest(fixtures.TablesTest):
    run_inserts = run_deletes = None

    __backend__ = True
    __requires__ = ("identity_columns", "table_reflection")

    @classmethod
    def define_tables(cls, metadata):
        Table(
            "t1",
            metadata,
            Column("normal", Integer),
            Column("id1", Integer, Identity()),
        )
        Table(
            "t2",
            metadata,
            Column(
                "id2",
                Integer,
                Identity(
                    always=True,
                    start=2,
                    increment=3,
                    minvalue=-2,
                    maxvalue=42,
                    cycle=True,
                    cache=4,
                ),
            ),
        )
        if testing.requires.schemas.enabled:
            Table(
                "t1",
                metadata,
                Column("normal", Integer),
                Column("id1", Integer, Identity(always=True, start=20)),
                schema=config.test_schema,
            )

    def check(self, value, exp, approx):
        if testing.requires.identity_columns_standard.enabled:
            common_keys = (
                "always",
                "start",
                "increment",
                "minvalue",
                "maxvalue",
                "cycle",
                "cache",
            )
            for k in list(value):
                if k not in common_keys:
                    value.pop(k)
            if approx:
                eq_(len(value), len(exp))
                for k in value:
                    if k == "minvalue":
                        is_true(value[k] <= exp[k])
                    elif k in {"maxvalue", "cache"}:
                        is_true(value[k] >= exp[k])
                    else:
                        eq_(value[k], exp[k], k)
            else:
                eq_(value, exp)
        else:
            eq_(value["start"], exp["start"])
            eq_(value["increment"], exp["increment"])

    def test_reflect_identity(self):
        insp = inspect(config.db)

        cols = insp.get_columns("t1") + insp.get_columns("t2")
        for col in cols:
            if col["name"] == "normal":
                is_false("identity" in col)
            elif col["name"] == "id1":
                if "autoincrement" in col:
                    is_true(col["autoincrement"])
                eq_(col["default"], None)
                is_true("identity" in col)
                self.check(
                    col["identity"],
                    dict(
                        always=False,
                        start=1,
                        increment=1,
                        minvalue=1,
                        maxvalue=2147483647,
                        cycle=False,
                        cache=1,
                    ),
                    approx=True,
                )
            elif col["name"] == "id2":
                if "autoincrement" in col:
                    is_true(col["autoincrement"])
                eq_(col["default"], None)
                is_true("identity" in col)
                self.check(
                    col["identity"],
                    dict(
                        always=True,
                        start=2,
                        increment=3,
                        minvalue=-2,
                        maxvalue=42,
                        cycle=True,
                        cache=4,
                    ),
                    approx=False,
                )

    @testing.requires.schemas
    def test_reflect_identity_schema(self):
        insp = inspect(config.db)

        cols = insp.get_columns("t1", schema=config.test_schema)
        for col in cols:
            if col["name"] == "normal":
                is_false("identity" in col)
            elif col["name"] == "id1":
                if "autoincrement" in col:
                    is_true(col["autoincrement"])
                eq_(col["default"], None)
                is_true("identity" in col)
                self.check(
                    col["identity"],
                    dict(
                        always=True,
                        start=20,
                        increment=1,
                        minvalue=1,
                        maxvalue=2147483647,
                        cycle=False,
                        cache=1,
                    ),
                    approx=True,
                )


class CompositeKeyReflectionTest(fixtures.TablesTest):
    __backend__ = True

    @classmethod
    def define_tables(cls, metadata):
        tb1 = Table(
            "tb1",
            metadata,
            Column("id", Integer),
            Column("attr", Integer),
            Column("name", sql_types.VARCHAR(20)),
            sa.PrimaryKeyConstraint("name", "id", "attr", name="pk_tb1"),
            schema=None,
            test_needs_fk=True,
        )
        Table(
            "tb2",
            metadata,
            Column("id", Integer, primary_key=True),
            Column("pid", Integer),
            Column("pattr", Integer),
            Column("pname", sql_types.VARCHAR(20)),
            sa.ForeignKeyConstraint(
                ["pname", "pid", "pattr"],
                [tb1.c.name, tb1.c.id, tb1.c.attr],
                name="fk_tb1_name_id_attr",
            ),
            schema=None,
            test_needs_fk=True,
        )

    @testing.requires.primary_key_constraint_reflection
    def test_pk_column_order(self, connection):
        # test for issue #5661
        insp = inspect(connection)
        primary_key = insp.get_pk_constraint(self.tables.tb1.name)
        eq_(primary_key.get("constrained_columns"), ["name", "id", "attr"])

    @testing.requires.foreign_key_constraint_reflection
    def test_fk_column_order(self, connection):
        # test for issue #5661
        insp = inspect(connection)
        foreign_keys = insp.get_foreign_keys(self.tables.tb2.name)
        eq_(len(foreign_keys), 1)
        fkey1 = foreign_keys[0]
        eq_(fkey1.get("referred_columns"), ["name", "id", "attr"])
        eq_(fkey1.get("constrained_columns"), ["pname", "pid", "pattr"])


__all__ = (
    "ComponentReflectionTest",
    "ComponentReflectionTestExtra",
    "TableNoColumnsTest",
    "QuotedNameArgumentTest",
    "BizarroCharacterFKResolutionTest",
    "HasTableTest",
    "HasIndexTest",
    "NormalizedNameTest",
    "ComputedReflectionTest",
    "IdentityReflectionTest",
    "CompositeKeyReflectionTest",
)
