"""Test against the builders in the op.* module."""

from sqlalchemy import Column
from sqlalchemy import event
from sqlalchemy import Integer
from sqlalchemy import String
from sqlalchemy import Table
from sqlalchemy.sql import text

from ...testing.fixtures import AlterColRoundTripFixture
from ...testing.fixtures import TestBase


@event.listens_for(Table, "after_parent_attach")
def _add_cols(table, metadata):
    if table.name == "tbl_with_auto_appended_column":
        table.append_column(Column("bat", Integer))


class BackendAlterColumnTest(AlterColRoundTripFixture, TestBase):
    __backend__ = True

    def test_rename_column(self):
        self._run_alter_col({}, {"name": "newname"})

    def test_modify_type_int_str(self):
        self._run_alter_col({"type": Integer()}, {"type": String(50)})

    def test_add_server_default_int(self):
        self._run_alter_col({"type": Integer}, {"server_default": text("5")})

    def test_modify_server_default_int(self):
        self._run_alter_col(
            {"type": Integer, "server_default": text("2")},
            {"server_default": text("5")},
        )

    def test_modify_nullable_to_non(self):
        self._run_alter_col({}, {"nullable": False})

    def test_modify_non_nullable_to_nullable(self):
        self._run_alter_col({"nullable": False}, {"nullable": True})
