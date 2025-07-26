# testing/fixtures/sql.py
# Copyright (C) 2005-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php
# mypy: ignore-errors
from __future__ import annotations

import itertools
import random
import re
import sys

import sqlalchemy as sa
from .base import TestBase
from .. import config
from .. import mock
from ..assertions import eq_
from ..assertions import ne_
from ..util import adict
from ..util import drop_all_tables_from_metadata
from ... import event
from ... import util
from ...schema import sort_tables_and_constraints
from ...sql import visitors
from ...sql.elements import ClauseElement


class TablesTest(TestBase):
    # 'once', None
    run_setup_bind = "once"

    # 'once', 'each', None
    run_define_tables = "once"

    # 'once', 'each', None
    run_create_tables = "once"

    # 'once', 'each', None
    run_inserts = "each"

    # 'each', None
    run_deletes = "each"

    # 'once', None
    run_dispose_bind = None

    bind = None
    _tables_metadata = None
    tables = None
    other = None
    sequences = None

    @config.fixture(autouse=True, scope="class")
    def _setup_tables_test_class(self):
        cls = self.__class__
        cls._init_class()

        cls._setup_once_tables()

        cls._setup_once_inserts()

        yield

        cls._teardown_once_metadata_bind()

    @config.fixture(autouse=True, scope="function")
    def _setup_tables_test_instance(self):
        self._setup_each_tables()
        self._setup_each_inserts()

        yield

        self._teardown_each_tables()

    @property
    def tables_test_metadata(self):
        return self._tables_metadata

    @classmethod
    def _init_class(cls):
        if cls.run_define_tables == "each":
            if cls.run_create_tables == "once":
                cls.run_create_tables = "each"
            assert cls.run_inserts in ("each", None)

        cls.other = adict()
        cls.tables = adict()
        cls.sequences = adict()

        cls.bind = cls.setup_bind()
        cls._tables_metadata = sa.MetaData()

    @classmethod
    def _setup_once_inserts(cls):
        if cls.run_inserts == "once":
            cls._load_fixtures()
            with cls.bind.begin() as conn:
                cls.insert_data(conn)

    @classmethod
    def _setup_once_tables(cls):
        if cls.run_define_tables == "once":
            cls.define_tables(cls._tables_metadata)
            if cls.run_create_tables == "once":
                cls._tables_metadata.create_all(cls.bind)
            cls.tables.update(cls._tables_metadata.tables)
            cls.sequences.update(cls._tables_metadata._sequences)

    def _setup_each_tables(self):
        if self.run_define_tables == "each":
            self.define_tables(self._tables_metadata)
            if self.run_create_tables == "each":
                self._tables_metadata.create_all(self.bind)
            self.tables.update(self._tables_metadata.tables)
            self.sequences.update(self._tables_metadata._sequences)
        elif self.run_create_tables == "each":
            self._tables_metadata.create_all(self.bind)

    def _setup_each_inserts(self):
        if self.run_inserts == "each":
            self._load_fixtures()
            with self.bind.begin() as conn:
                self.insert_data(conn)

    def _teardown_each_tables(self):
        if self.run_define_tables == "each":
            self.tables.clear()
            if self.run_create_tables == "each":
                drop_all_tables_from_metadata(self._tables_metadata, self.bind)
            self._tables_metadata.clear()
        elif self.run_create_tables == "each":
            drop_all_tables_from_metadata(self._tables_metadata, self.bind)

        savepoints = getattr(config.requirements, "savepoints", False)
        if savepoints:
            savepoints = savepoints.enabled

        # no need to run deletes if tables are recreated on setup
        if (
            self.run_define_tables != "each"
            and self.run_create_tables != "each"
            and self.run_deletes == "each"
        ):
            with self.bind.begin() as conn:
                for table in reversed(
                    [
                        t
                        for (t, fks) in sort_tables_and_constraints(
                            self._tables_metadata.tables.values()
                        )
                        if t is not None
                    ]
                ):
                    try:
                        if savepoints:
                            with conn.begin_nested():
                                conn.execute(table.delete())
                        else:
                            conn.execute(table.delete())
                    except sa.exc.DBAPIError as ex:
                        print(
                            ("Error emptying table %s: %r" % (table, ex)),
                            file=sys.stderr,
                        )

    @classmethod
    def _teardown_once_metadata_bind(cls):
        if cls.run_create_tables:
            drop_all_tables_from_metadata(cls._tables_metadata, cls.bind)

        if cls.run_dispose_bind == "once":
            cls.dispose_bind(cls.bind)

        cls._tables_metadata.bind = None

        if cls.run_setup_bind is not None:
            cls.bind = None

    @classmethod
    def setup_bind(cls):
        return config.db

    @classmethod
    def dispose_bind(cls, bind):
        if hasattr(bind, "dispose"):
            bind.dispose()
        elif hasattr(bind, "close"):
            bind.close()

    @classmethod
    def define_tables(cls, metadata):
        pass

    @classmethod
    def fixtures(cls):
        return {}

    @classmethod
    def insert_data(cls, connection):
        pass

    def sql_count_(self, count, fn):
        self.assert_sql_count(self.bind, fn, count)

    def sql_eq_(self, callable_, statements):
        self.assert_sql(self.bind, callable_, statements)

    @classmethod
    def _load_fixtures(cls):
        """Insert rows as represented by the fixtures() method."""
        headers, rows = {}, {}
        for table, data in cls.fixtures().items():
            if len(data) < 2:
                continue
            if isinstance(table, str):
                table = cls.tables[table]
            headers[table] = data[0]
            rows[table] = data[1:]
        for table, fks in sort_tables_and_constraints(
            cls._tables_metadata.tables.values()
        ):
            if table is None:
                continue
            if table not in headers:
                continue
            with cls.bind.begin() as conn:
                conn.execute(
                    table.insert(),
                    [
                        dict(zip(headers[table], column_values))
                        for column_values in rows[table]
                    ],
                )


class NoCache:
    @config.fixture(autouse=True, scope="function")
    def _disable_cache(self):
        _cache = config.db._compiled_cache
        config.db._compiled_cache = None
        yield
        config.db._compiled_cache = _cache


class RemovesEvents:
    @util.memoized_property
    def _event_fns(self):
        return set()

    def event_listen(self, target, name, fn, **kw):
        self._event_fns.add((target, name, fn))
        event.listen(target, name, fn, **kw)

    @config.fixture(autouse=True, scope="function")
    def _remove_events(self):
        yield
        for key in self._event_fns:
            event.remove(*key)


class ComputedReflectionFixtureTest(TablesTest):
    run_inserts = run_deletes = None

    __backend__ = True
    __requires__ = ("computed_columns", "table_reflection")

    regexp = re.compile(r"[\[\]\(\)\s`'\"]*")

    def normalize(self, text):
        return self.regexp.sub("", text).lower()

    @classmethod
    def define_tables(cls, metadata):
        from ... import Integer
        from ... import testing
        from ...schema import Column
        from ...schema import Computed
        from ...schema import Table

        Table(
            "computed_default_table",
            metadata,
            Column("id", Integer, primary_key=True),
            Column("normal", Integer),
            Column("computed_col", Integer, Computed("normal + 42")),
            Column("with_default", Integer, server_default="42"),
        )

        t = Table(
            "computed_column_table",
            metadata,
            Column("id", Integer, primary_key=True),
            Column("normal", Integer),
            Column("computed_no_flag", Integer, Computed("normal + 42")),
        )

        if testing.requires.schemas.enabled:
            t2 = Table(
                "computed_column_table",
                metadata,
                Column("id", Integer, primary_key=True),
                Column("normal", Integer),
                Column("computed_no_flag", Integer, Computed("normal / 42")),
                schema=config.test_schema,
            )

        if testing.requires.computed_columns_virtual.enabled:
            t.append_column(
                Column(
                    "computed_virtual",
                    Integer,
                    Computed("normal + 2", persisted=False),
                )
            )
            if testing.requires.schemas.enabled:
                t2.append_column(
                    Column(
                        "computed_virtual",
                        Integer,
                        Computed("normal / 2", persisted=False),
                    )
                )
        if testing.requires.computed_columns_stored.enabled:
            t.append_column(
                Column(
                    "computed_stored",
                    Integer,
                    Computed("normal - 42", persisted=True),
                )
            )
            if testing.requires.schemas.enabled:
                t2.append_column(
                    Column(
                        "computed_stored",
                        Integer,
                        Computed("normal * 42", persisted=True),
                    )
                )


class CacheKeyFixture:
    def _compare_equal(self, a, b, compare_values):
        a_key = a._generate_cache_key()
        b_key = b._generate_cache_key()

        if a_key is None:
            assert a._annotations.get("nocache")

            assert b_key is None
        else:
            eq_(a_key.key, b_key.key)
            eq_(hash(a_key.key), hash(b_key.key))

            for a_param, b_param in zip(a_key.bindparams, b_key.bindparams):
                assert a_param.compare(b_param, compare_values=compare_values)
        return a_key, b_key

    def _run_cache_key_fixture(self, fixture, compare_values):
        case_a = fixture()
        case_b = fixture()

        for a, b in itertools.combinations_with_replacement(
            range(len(case_a)), 2
        ):
            if a == b:
                a_key, b_key = self._compare_equal(
                    case_a[a], case_b[b], compare_values
                )
                if a_key is None:
                    continue
            else:
                a_key = case_a[a]._generate_cache_key()
                b_key = case_b[b]._generate_cache_key()

                if a_key is None or b_key is None:
                    if a_key is None:
                        assert case_a[a]._annotations.get("nocache")
                    if b_key is None:
                        assert case_b[b]._annotations.get("nocache")
                    continue

                if a_key.key == b_key.key:
                    for a_param, b_param in zip(
                        a_key.bindparams, b_key.bindparams
                    ):
                        if not a_param.compare(
                            b_param, compare_values=compare_values
                        ):
                            break
                    else:
                        # this fails unconditionally since we could not
                        # find bound parameter values that differed.
                        # Usually we intended to get two distinct keys here
                        # so the failure will be more descriptive using the
                        # ne_() assertion.
                        ne_(a_key.key, b_key.key)
                else:
                    ne_(a_key.key, b_key.key)

            # ClauseElement-specific test to ensure the cache key
            # collected all the bound parameters that aren't marked
            # as "literal execute"
            if isinstance(case_a[a], ClauseElement) and isinstance(
                case_b[b], ClauseElement
            ):
                assert_a_params = []
                assert_b_params = []

                for elem in visitors.iterate(case_a[a]):
                    if elem.__visit_name__ == "bindparam":
                        assert_a_params.append(elem)

                for elem in visitors.iterate(case_b[b]):
                    if elem.__visit_name__ == "bindparam":
                        assert_b_params.append(elem)

                # note we're asserting the order of the params as well as
                # if there are dupes or not.  ordering has to be
                # deterministic and matches what a traversal would provide.
                eq_(
                    sorted(a_key.bindparams, key=lambda b: b.key),
                    sorted(
                        util.unique_list(assert_a_params), key=lambda b: b.key
                    ),
                )
                eq_(
                    sorted(b_key.bindparams, key=lambda b: b.key),
                    sorted(
                        util.unique_list(assert_b_params), key=lambda b: b.key
                    ),
                )

    def _run_cache_key_equal_fixture(self, fixture, compare_values):
        case_a = fixture()
        case_b = fixture()

        for a, b in itertools.combinations_with_replacement(
            range(len(case_a)), 2
        ):
            self._compare_equal(case_a[a], case_b[b], compare_values)


def insertmanyvalues_fixture(
    connection, randomize_rows=False, warn_on_downgraded=False
):
    dialect = connection.dialect
    orig_dialect = dialect._deliver_insertmanyvalues_batches
    orig_conn = connection._exec_insertmany_context

    class RandomCursor:
        __slots__ = ("cursor",)

        def __init__(self, cursor):
            self.cursor = cursor

        # only this method is called by the deliver method.
        # by not having the other methods we assert that those aren't being
        # used

        def fetchall(self):
            rows = self.cursor.fetchall()
            rows = list(rows)
            random.shuffle(rows)
            return rows

    def _deliver_insertmanyvalues_batches(
        cursor, statement, parameters, generic_setinputsizes, context
    ):
        if randomize_rows:
            cursor = RandomCursor(cursor)
        for batch in orig_dialect(
            cursor, statement, parameters, generic_setinputsizes, context
        ):
            if warn_on_downgraded and batch.is_downgraded:
                util.warn("Batches were downgraded for sorted INSERT")

            yield batch

    def _exec_insertmany_context(
        dialect,
        context,
    ):
        with mock.patch.object(
            dialect,
            "_deliver_insertmanyvalues_batches",
            new=_deliver_insertmanyvalues_batches,
        ):
            return orig_conn(dialect, context)

    connection._exec_insertmany_context = _exec_insertmany_context
