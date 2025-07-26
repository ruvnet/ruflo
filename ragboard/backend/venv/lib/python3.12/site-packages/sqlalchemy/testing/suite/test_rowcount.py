# testing/suite/test_rowcount.py
# Copyright (C) 2005-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php
# mypy: ignore-errors

from sqlalchemy import bindparam
from sqlalchemy import Column
from sqlalchemy import Integer
from sqlalchemy import MetaData
from sqlalchemy import select
from sqlalchemy import String
from sqlalchemy import Table
from sqlalchemy import testing
from sqlalchemy import text
from sqlalchemy.testing import eq_
from sqlalchemy.testing import fixtures


class RowCountTest(fixtures.TablesTest):
    """test rowcount functionality"""

    __requires__ = ("sane_rowcount",)
    __backend__ = True

    @classmethod
    def define_tables(cls, metadata):
        Table(
            "employees",
            metadata,
            Column(
                "employee_id",
                Integer,
                autoincrement=False,
                primary_key=True,
            ),
            Column("name", String(50)),
            Column("department", String(1)),
        )

    @classmethod
    def insert_data(cls, connection):
        cls.data = data = [
            ("Angela", "A"),
            ("Andrew", "A"),
            ("Anand", "A"),
            ("Bob", "B"),
            ("Bobette", "B"),
            ("Buffy", "B"),
            ("Charlie", "C"),
            ("Cynthia", "C"),
            ("Chris", "C"),
        ]

        employees_table = cls.tables.employees
        connection.execute(
            employees_table.insert(),
            [
                {"employee_id": i, "name": n, "department": d}
                for i, (n, d) in enumerate(data)
            ],
        )

    def test_basic(self, connection):
        employees_table = self.tables.employees
        s = select(
            employees_table.c.name, employees_table.c.department
        ).order_by(employees_table.c.employee_id)
        rows = connection.execute(s).fetchall()

        eq_(rows, self.data)

    @testing.variation("statement", ["update", "delete", "insert", "select"])
    @testing.variation("close_first", [True, False])
    def test_non_rowcount_scenarios_no_raise(
        self, connection, statement, close_first
    ):
        employees_table = self.tables.employees

        # WHERE matches 3, 3 rows changed
        department = employees_table.c.department

        if statement.update:
            r = connection.execute(
                employees_table.update().where(department == "C"),
                {"department": "Z"},
            )
        elif statement.delete:
            r = connection.execute(
                employees_table.delete().where(department == "C"),
                {"department": "Z"},
            )
        elif statement.insert:
            r = connection.execute(
                employees_table.insert(),
                [
                    {"employee_id": 25, "name": "none 1", "department": "X"},
                    {"employee_id": 26, "name": "none 2", "department": "Z"},
                    {"employee_id": 27, "name": "none 3", "department": "Z"},
                ],
            )
        elif statement.select:
            s = select(
                employees_table.c.name, employees_table.c.department
            ).where(employees_table.c.department == "C")
            r = connection.execute(s)
            r.all()
        else:
            statement.fail()

        if close_first:
            r.close()

        assert r.rowcount in (-1, 3)

    def test_update_rowcount1(self, connection):
        employees_table = self.tables.employees

        # WHERE matches 3, 3 rows changed
        department = employees_table.c.department
        r = connection.execute(
            employees_table.update().where(department == "C"),
            {"department": "Z"},
        )
        assert r.rowcount == 3

    def test_update_rowcount2(self, connection):
        employees_table = self.tables.employees

        # WHERE matches 3, 0 rows changed
        department = employees_table.c.department

        r = connection.execute(
            employees_table.update().where(department == "C"),
            {"department": "C"},
        )
        eq_(r.rowcount, 3)

    @testing.variation("implicit_returning", [True, False])
    @testing.variation(
        "dml",
        [
            ("update", testing.requires.update_returning),
            ("delete", testing.requires.delete_returning),
        ],
    )
    def test_update_delete_rowcount_return_defaults(
        self, connection, implicit_returning, dml
    ):
        """note this test should succeed for all RETURNING backends
        as of 2.0.  In
        Idf28379f8705e403a3c6a937f6a798a042ef2540 we changed rowcount to use
        len(rows) when we have implicit returning

        """

        if implicit_returning:
            employees_table = self.tables.employees
        else:
            employees_table = Table(
                "employees",
                MetaData(),
                Column(
                    "employee_id",
                    Integer,
                    autoincrement=False,
                    primary_key=True,
                ),
                Column("name", String(50)),
                Column("department", String(1)),
                implicit_returning=False,
            )

        department = employees_table.c.department

        if dml.update:
            stmt = (
                employees_table.update()
                .where(department == "C")
                .values(name=employees_table.c.department + "Z")
                .return_defaults()
            )
        elif dml.delete:
            stmt = (
                employees_table.delete()
                .where(department == "C")
                .return_defaults()
            )
        else:
            dml.fail()

        r = connection.execute(stmt)
        eq_(r.rowcount, 3)

    def test_raw_sql_rowcount(self, connection):
        # test issue #3622, make sure eager rowcount is called for text
        result = connection.exec_driver_sql(
            "update employees set department='Z' where department='C'"
        )
        eq_(result.rowcount, 3)

    def test_text_rowcount(self, connection):
        # test issue #3622, make sure eager rowcount is called for text
        result = connection.execute(
            text("update employees set department='Z' " "where department='C'")
        )
        eq_(result.rowcount, 3)

    def test_delete_rowcount(self, connection):
        employees_table = self.tables.employees

        # WHERE matches 3, 3 rows deleted
        department = employees_table.c.department
        r = connection.execute(
            employees_table.delete().where(department == "C")
        )
        eq_(r.rowcount, 3)

    @testing.requires.sane_multi_rowcount
    def test_multi_update_rowcount(self, connection):
        employees_table = self.tables.employees
        stmt = (
            employees_table.update()
            .where(employees_table.c.name == bindparam("emp_name"))
            .values(department="C")
        )

        r = connection.execute(
            stmt,
            [
                {"emp_name": "Bob"},
                {"emp_name": "Cynthia"},
                {"emp_name": "nonexistent"},
            ],
        )

        eq_(r.rowcount, 2)

    @testing.requires.sane_multi_rowcount
    def test_multi_delete_rowcount(self, connection):
        employees_table = self.tables.employees

        stmt = employees_table.delete().where(
            employees_table.c.name == bindparam("emp_name")
        )

        r = connection.execute(
            stmt,
            [
                {"emp_name": "Bob"},
                {"emp_name": "Cynthia"},
                {"emp_name": "nonexistent"},
            ],
        )

        eq_(r.rowcount, 2)
