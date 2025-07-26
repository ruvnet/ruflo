# schema.py
# Copyright (C) 2005-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php

"""Compatibility namespace for sqlalchemy.sql.schema and related.

"""

from __future__ import annotations

from .sql.base import SchemaVisitor as SchemaVisitor
from .sql.ddl import _CreateDropBase as _CreateDropBase
from .sql.ddl import _DropView as _DropView
from .sql.ddl import AddConstraint as AddConstraint
from .sql.ddl import BaseDDLElement as BaseDDLElement
from .sql.ddl import CreateColumn as CreateColumn
from .sql.ddl import CreateIndex as CreateIndex
from .sql.ddl import CreateSchema as CreateSchema
from .sql.ddl import CreateSequence as CreateSequence
from .sql.ddl import CreateTable as CreateTable
from .sql.ddl import DDL as DDL
from .sql.ddl import DDLElement as DDLElement
from .sql.ddl import DropColumnComment as DropColumnComment
from .sql.ddl import DropConstraint as DropConstraint
from .sql.ddl import DropConstraintComment as DropConstraintComment
from .sql.ddl import DropIndex as DropIndex
from .sql.ddl import DropSchema as DropSchema
from .sql.ddl import DropSequence as DropSequence
from .sql.ddl import DropTable as DropTable
from .sql.ddl import DropTableComment as DropTableComment
from .sql.ddl import ExecutableDDLElement as ExecutableDDLElement
from .sql.ddl import InvokeDDLBase as InvokeDDLBase
from .sql.ddl import SetColumnComment as SetColumnComment
from .sql.ddl import SetConstraintComment as SetConstraintComment
from .sql.ddl import SetTableComment as SetTableComment
from .sql.ddl import sort_tables as sort_tables
from .sql.ddl import (
    sort_tables_and_constraints as sort_tables_and_constraints,
)
from .sql.naming import conv as conv
from .sql.schema import _get_table_key as _get_table_key
from .sql.schema import BLANK_SCHEMA as BLANK_SCHEMA
from .sql.schema import CheckConstraint as CheckConstraint
from .sql.schema import Column as Column
from .sql.schema import (
    ColumnCollectionConstraint as ColumnCollectionConstraint,
)
from .sql.schema import ColumnCollectionMixin as ColumnCollectionMixin
from .sql.schema import ColumnDefault as ColumnDefault
from .sql.schema import Computed as Computed
from .sql.schema import Constraint as Constraint
from .sql.schema import DefaultClause as DefaultClause
from .sql.schema import DefaultGenerator as DefaultGenerator
from .sql.schema import FetchedValue as FetchedValue
from .sql.schema import ForeignKey as ForeignKey
from .sql.schema import ForeignKeyConstraint as ForeignKeyConstraint
from .sql.schema import HasConditionalDDL as HasConditionalDDL
from .sql.schema import Identity as Identity
from .sql.schema import Index as Index
from .sql.schema import insert_sentinel as insert_sentinel
from .sql.schema import MetaData as MetaData
from .sql.schema import PrimaryKeyConstraint as PrimaryKeyConstraint
from .sql.schema import SchemaConst as SchemaConst
from .sql.schema import SchemaItem as SchemaItem
from .sql.schema import Sequence as Sequence
from .sql.schema import Table as Table
from .sql.schema import UniqueConstraint as UniqueConstraint
