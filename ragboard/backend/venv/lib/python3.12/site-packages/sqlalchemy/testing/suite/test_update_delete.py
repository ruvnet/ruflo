# testing/suite/test_update_delete.py
# Copyright (C) 2005-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php
# mypy: ignore-errors

from .. import fixtures
from ..assertions import eq_
from ..schema import Column
from ..schema import Table
from ... import Integer
from ... import String
from ... import testing


class SimpleUpdateDeleteTest(fixtures.TablesTest):
    run_deletes = "each"
    __requires__ = ("sane_rowcount",)
    __backend__ = True

    @classmethod
    def define_tables(cls, metadata):
        Table(
            "plain_pk",
            metadata,
            Column("id", Integer, primary_key=True),
            Column("data", String(50)),
        )

    @classmethod
    def insert_data(cls, connection):
        connection.execute(
            cls.tables.plain_pk.insert(),
            [
                {"id": 1, "data": "d1"},
                {"id": 2, "data": "d2"},
                {"id": 3, "data": "d3"},
            ],
        )

    def test_update(self, connection):
        t = self.tables.plain_pk
        r = connection.execute(
            t.update().where(t.c.id == 2), dict(data="d2_new")
        )
        assert not r.is_insert
        assert not r.returns_rows
        assert r.rowcount == 1

        eq_(
            connection.execute(t.select().order_by(t.c.id)).fetchall(),
            [(1, "d1"), (2, "d2_new"), (3, "d3")],
        )

    def test_delete(self, connection):
        t = self.tables.plain_pk
        r = connection.execute(t.delete().where(t.c.id == 2))
        assert not r.is_insert
        assert not r.returns_rows
        assert r.rowcount == 1
        eq_(
            connection.execute(t.select().order_by(t.c.id)).fetchall(),
            [(1, "d1"), (3, "d3")],
        )

    @testing.variation("criteria", ["rows", "norows", "emptyin"])
    @testing.requires.update_returning
    def test_update_returning(self, connection, criteria):
        t = self.tables.plain_pk

        stmt = t.update().returning(t.c.id, t.c.data)

        if criteria.norows:
            stmt = stmt.where(t.c.id == 10)
        elif criteria.rows:
            stmt = stmt.where(t.c.id == 2)
        elif criteria.emptyin:
            stmt = stmt.where(t.c.id.in_([]))
        else:
            criteria.fail()

        r = connection.execute(stmt, dict(data="d2_new"))
        assert not r.is_insert
        assert r.returns_rows
        eq_(r.keys(), ["id", "data"])

        if criteria.rows:
            eq_(r.all(), [(2, "d2_new")])
        else:
            eq_(r.all(), [])

        eq_(
            connection.execute(t.select().order_by(t.c.id)).fetchall(),
            [(1, "d1"), (2, "d2_new"), (3, "d3")]
            if criteria.rows
            else [(1, "d1"), (2, "d2"), (3, "d3")],
        )

    @testing.variation("criteria", ["rows", "norows", "emptyin"])
    @testing.requires.delete_returning
    def test_delete_returning(self, connection, criteria):
        t = self.tables.plain_pk

        stmt = t.delete().returning(t.c.id, t.c.data)

        if criteria.norows:
            stmt = stmt.where(t.c.id == 10)
        elif criteria.rows:
            stmt = stmt.where(t.c.id == 2)
        elif criteria.emptyin:
            stmt = stmt.where(t.c.id.in_([]))
        else:
            criteria.fail()

        r = connection.execute(stmt)
        assert not r.is_insert
        assert r.returns_rows
        eq_(r.keys(), ["id", "data"])

        if criteria.rows:
            eq_(r.all(), [(2, "d2")])
        else:
            eq_(r.all(), [])

        eq_(
            connection.execute(t.select().order_by(t.c.id)).fetchall(),
            [(1, "d1"), (3, "d3")]
            if criteria.rows
            else [(1, "d1"), (2, "d2"), (3, "d3")],
        )


__all__ = ("SimpleUpdateDeleteTest",)
