# testing/suite/test_sequence.py
# Copyright (C) 2005-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php
# mypy: ignore-errors

from .. import config
from .. import fixtures
from ..assertions import eq_
from ..assertions import is_true
from ..config import requirements
from ..provision import normalize_sequence
from ..schema import Column
from ..schema import Table
from ... import inspect
from ... import Integer
from ... import MetaData
from ... import Sequence
from ... import String
from ... import testing


class SequenceTest(fixtures.TablesTest):
    __requires__ = ("sequences",)
    __backend__ = True

    run_create_tables = "each"

    @classmethod
    def define_tables(cls, metadata):
        Table(
            "seq_pk",
            metadata,
            Column(
                "id",
                Integer,
                normalize_sequence(config, Sequence("tab_id_seq")),
                primary_key=True,
            ),
            Column("data", String(50)),
        )

        Table(
            "seq_opt_pk",
            metadata,
            Column(
                "id",
                Integer,
                normalize_sequence(
                    config,
                    Sequence("tab_id_seq", data_type=Integer, optional=True),
                ),
                primary_key=True,
            ),
            Column("data", String(50)),
        )

        Table(
            "seq_no_returning",
            metadata,
            Column(
                "id",
                Integer,
                normalize_sequence(config, Sequence("noret_id_seq")),
                primary_key=True,
            ),
            Column("data", String(50)),
            implicit_returning=False,
        )

        if testing.requires.schemas.enabled:
            Table(
                "seq_no_returning_sch",
                metadata,
                Column(
                    "id",
                    Integer,
                    normalize_sequence(
                        config,
                        Sequence(
                            "noret_sch_id_seq", schema=config.test_schema
                        ),
                    ),
                    primary_key=True,
                ),
                Column("data", String(50)),
                implicit_returning=False,
                schema=config.test_schema,
            )

    def test_insert_roundtrip(self, connection):
        connection.execute(self.tables.seq_pk.insert(), dict(data="some data"))
        self._assert_round_trip(self.tables.seq_pk, connection)

    def test_insert_lastrowid(self, connection):
        r = connection.execute(
            self.tables.seq_pk.insert(), dict(data="some data")
        )
        eq_(
            r.inserted_primary_key, (testing.db.dialect.default_sequence_base,)
        )

    def test_nextval_direct(self, connection):
        r = connection.scalar(self.tables.seq_pk.c.id.default)
        eq_(r, testing.db.dialect.default_sequence_base)

    @requirements.sequences_optional
    def test_optional_seq(self, connection):
        r = connection.execute(
            self.tables.seq_opt_pk.insert(), dict(data="some data")
        )
        eq_(r.inserted_primary_key, (1,))

    def _assert_round_trip(self, table, conn):
        row = conn.execute(table.select()).first()
        eq_(row, (testing.db.dialect.default_sequence_base, "some data"))

    def test_insert_roundtrip_no_implicit_returning(self, connection):
        connection.execute(
            self.tables.seq_no_returning.insert(), dict(data="some data")
        )
        self._assert_round_trip(self.tables.seq_no_returning, connection)

    @testing.combinations((True,), (False,), argnames="implicit_returning")
    @testing.requires.schemas
    def test_insert_roundtrip_translate(self, connection, implicit_returning):
        seq_no_returning = Table(
            "seq_no_returning_sch",
            MetaData(),
            Column(
                "id",
                Integer,
                normalize_sequence(
                    config, Sequence("noret_sch_id_seq", schema="alt_schema")
                ),
                primary_key=True,
            ),
            Column("data", String(50)),
            implicit_returning=implicit_returning,
            schema="alt_schema",
        )

        connection = connection.execution_options(
            schema_translate_map={"alt_schema": config.test_schema}
        )
        connection.execute(seq_no_returning.insert(), dict(data="some data"))
        self._assert_round_trip(seq_no_returning, connection)

    @testing.requires.schemas
    def test_nextval_direct_schema_translate(self, connection):
        seq = normalize_sequence(
            config, Sequence("noret_sch_id_seq", schema="alt_schema")
        )
        connection = connection.execution_options(
            schema_translate_map={"alt_schema": config.test_schema}
        )

        r = connection.scalar(seq)
        eq_(r, testing.db.dialect.default_sequence_base)


class SequenceCompilerTest(testing.AssertsCompiledSQL, fixtures.TestBase):
    __requires__ = ("sequences",)
    __backend__ = True

    def test_literal_binds_inline_compile(self, connection):
        table = Table(
            "x",
            MetaData(),
            Column(
                "y", Integer, normalize_sequence(config, Sequence("y_seq"))
            ),
            Column("q", Integer),
        )

        stmt = table.insert().values(q=5)

        seq_nextval = connection.dialect.statement_compiler(
            statement=None, dialect=connection.dialect
        ).visit_sequence(normalize_sequence(config, Sequence("y_seq")))
        self.assert_compile(
            stmt,
            "INSERT INTO x (y, q) VALUES (%s, 5)" % (seq_nextval,),
            literal_binds=True,
            dialect=connection.dialect,
        )


class HasSequenceTest(fixtures.TablesTest):
    run_deletes = None

    __requires__ = ("sequences",)
    __backend__ = True

    @classmethod
    def define_tables(cls, metadata):
        normalize_sequence(config, Sequence("user_id_seq", metadata=metadata))
        normalize_sequence(
            config,
            Sequence(
                "other_seq",
                metadata=metadata,
                nomaxvalue=True,
                nominvalue=True,
            ),
        )
        if testing.requires.schemas.enabled:
            normalize_sequence(
                config,
                Sequence(
                    "user_id_seq", schema=config.test_schema, metadata=metadata
                ),
            )
            normalize_sequence(
                config,
                Sequence(
                    "schema_seq", schema=config.test_schema, metadata=metadata
                ),
            )
        Table(
            "user_id_table",
            metadata,
            Column("id", Integer, primary_key=True),
        )

    def test_has_sequence(self, connection):
        eq_(inspect(connection).has_sequence("user_id_seq"), True)

    def test_has_sequence_cache(self, connection, metadata):
        insp = inspect(connection)
        eq_(insp.has_sequence("user_id_seq"), True)
        ss = normalize_sequence(config, Sequence("new_seq", metadata=metadata))
        eq_(insp.has_sequence("new_seq"), False)
        ss.create(connection)
        try:
            eq_(insp.has_sequence("new_seq"), False)
            insp.clear_cache()
            eq_(insp.has_sequence("new_seq"), True)
        finally:
            ss.drop(connection)

    def test_has_sequence_other_object(self, connection):
        eq_(inspect(connection).has_sequence("user_id_table"), False)

    @testing.requires.schemas
    def test_has_sequence_schema(self, connection):
        eq_(
            inspect(connection).has_sequence(
                "user_id_seq", schema=config.test_schema
            ),
            True,
        )

    def test_has_sequence_neg(self, connection):
        eq_(inspect(connection).has_sequence("some_sequence"), False)

    @testing.requires.schemas
    def test_has_sequence_schemas_neg(self, connection):
        eq_(
            inspect(connection).has_sequence(
                "some_sequence", schema=config.test_schema
            ),
            False,
        )

    @testing.requires.schemas
    def test_has_sequence_default_not_in_remote(self, connection):
        eq_(
            inspect(connection).has_sequence(
                "other_sequence", schema=config.test_schema
            ),
            False,
        )

    @testing.requires.schemas
    def test_has_sequence_remote_not_in_default(self, connection):
        eq_(inspect(connection).has_sequence("schema_seq"), False)

    def test_get_sequence_names(self, connection):
        exp = {"other_seq", "user_id_seq"}

        res = set(inspect(connection).get_sequence_names())
        is_true(res.intersection(exp) == exp)
        is_true("schema_seq" not in res)

    @testing.requires.schemas
    def test_get_sequence_names_no_sequence_schema(self, connection):
        eq_(
            inspect(connection).get_sequence_names(
                schema=config.test_schema_2
            ),
            [],
        )

    @testing.requires.schemas
    def test_get_sequence_names_sequences_schema(self, connection):
        eq_(
            sorted(
                inspect(connection).get_sequence_names(
                    schema=config.test_schema
                )
            ),
            ["schema_seq", "user_id_seq"],
        )


class HasSequenceTestEmpty(fixtures.TestBase):
    __requires__ = ("sequences",)
    __backend__ = True

    def test_get_sequence_names_no_sequence(self, connection):
        eq_(
            inspect(connection).get_sequence_names(),
            [],
        )
