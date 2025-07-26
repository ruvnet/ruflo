# __init__.py
# Copyright (C) 2005-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php

from __future__ import annotations

from typing import Any

from . import util as _util
from .engine import AdaptedConnection as AdaptedConnection
from .engine import BaseRow as BaseRow
from .engine import BindTyping as BindTyping
from .engine import ChunkedIteratorResult as ChunkedIteratorResult
from .engine import Compiled as Compiled
from .engine import Connection as Connection
from .engine import create_engine as create_engine
from .engine import create_mock_engine as create_mock_engine
from .engine import create_pool_from_url as create_pool_from_url
from .engine import CreateEnginePlugin as CreateEnginePlugin
from .engine import CursorResult as CursorResult
from .engine import Dialect as Dialect
from .engine import Engine as Engine
from .engine import engine_from_config as engine_from_config
from .engine import ExceptionContext as ExceptionContext
from .engine import ExecutionContext as ExecutionContext
from .engine import FrozenResult as FrozenResult
from .engine import Inspector as Inspector
from .engine import IteratorResult as IteratorResult
from .engine import make_url as make_url
from .engine import MappingResult as MappingResult
from .engine import MergedResult as MergedResult
from .engine import NestedTransaction as NestedTransaction
from .engine import Result as Result
from .engine import result_tuple as result_tuple
from .engine import ResultProxy as ResultProxy
from .engine import RootTransaction as RootTransaction
from .engine import Row as Row
from .engine import RowMapping as RowMapping
from .engine import ScalarResult as ScalarResult
from .engine import Transaction as Transaction
from .engine import TwoPhaseTransaction as TwoPhaseTransaction
from .engine import TypeCompiler as TypeCompiler
from .engine import URL as URL
from .inspection import inspect as inspect
from .pool import AssertionPool as AssertionPool
from .pool import AsyncAdaptedQueuePool as AsyncAdaptedQueuePool
from .pool import (
    FallbackAsyncAdaptedQueuePool as FallbackAsyncAdaptedQueuePool,
)
from .pool import NullPool as NullPool
from .pool import Pool as Pool
from .pool import PoolProxiedConnection as PoolProxiedConnection
from .pool import PoolResetState as PoolResetState
from .pool import QueuePool as QueuePool
from .pool import SingletonThreadPool as SingletonThreadPool
from .pool import StaticPool as StaticPool
from .schema import BaseDDLElement as BaseDDLElement
from .schema import BLANK_SCHEMA as BLANK_SCHEMA
from .schema import CheckConstraint as CheckConstraint
from .schema import Column as Column
from .schema import ColumnDefault as ColumnDefault
from .schema import Computed as Computed
from .schema import Constraint as Constraint
from .schema import DDL as DDL
from .schema import DDLElement as DDLElement
from .schema import DefaultClause as DefaultClause
from .schema import ExecutableDDLElement as ExecutableDDLElement
from .schema import FetchedValue as FetchedValue
from .schema import ForeignKey as ForeignKey
from .schema import ForeignKeyConstraint as ForeignKeyConstraint
from .schema import Identity as Identity
from .schema import Index as Index
from .schema import insert_sentinel as insert_sentinel
from .schema import MetaData as MetaData
from .schema import PrimaryKeyConstraint as PrimaryKeyConstraint
from .schema import Sequence as Sequence
from .schema import Table as Table
from .schema import UniqueConstraint as UniqueConstraint
from .sql import ColumnExpressionArgument as ColumnExpressionArgument
from .sql import NotNullable as NotNullable
from .sql import Nullable as Nullable
from .sql import SelectLabelStyle as SelectLabelStyle
from .sql.expression import Alias as Alias
from .sql.expression import alias as alias
from .sql.expression import AliasedReturnsRows as AliasedReturnsRows
from .sql.expression import all_ as all_
from .sql.expression import and_ as and_
from .sql.expression import any_ as any_
from .sql.expression import asc as asc
from .sql.expression import between as between
from .sql.expression import BinaryExpression as BinaryExpression
from .sql.expression import bindparam as bindparam
from .sql.expression import BindParameter as BindParameter
from .sql.expression import bitwise_not as bitwise_not
from .sql.expression import BooleanClauseList as BooleanClauseList
from .sql.expression import CacheKey as CacheKey
from .sql.expression import Case as Case
from .sql.expression import case as case
from .sql.expression import Cast as Cast
from .sql.expression import cast as cast
from .sql.expression import ClauseElement as ClauseElement
from .sql.expression import ClauseList as ClauseList
from .sql.expression import collate as collate
from .sql.expression import CollectionAggregate as CollectionAggregate
from .sql.expression import column as column
from .sql.expression import ColumnClause as ColumnClause
from .sql.expression import ColumnCollection as ColumnCollection
from .sql.expression import ColumnElement as ColumnElement
from .sql.expression import ColumnOperators as ColumnOperators
from .sql.expression import CompoundSelect as CompoundSelect
from .sql.expression import CTE as CTE
from .sql.expression import cte as cte
from .sql.expression import custom_op as custom_op
from .sql.expression import Delete as Delete
from .sql.expression import delete as delete
from .sql.expression import desc as desc
from .sql.expression import distinct as distinct
from .sql.expression import except_ as except_
from .sql.expression import except_all as except_all
from .sql.expression import Executable as Executable
from .sql.expression import Exists as Exists
from .sql.expression import exists as exists
from .sql.expression import Extract as Extract
from .sql.expression import extract as extract
from .sql.expression import false as false
from .sql.expression import False_ as False_
from .sql.expression import FromClause as FromClause
from .sql.expression import FromGrouping as FromGrouping
from .sql.expression import func as func
from .sql.expression import funcfilter as funcfilter
from .sql.expression import Function as Function
from .sql.expression import FunctionElement as FunctionElement
from .sql.expression import FunctionFilter as FunctionFilter
from .sql.expression import GenerativeSelect as GenerativeSelect
from .sql.expression import Grouping as Grouping
from .sql.expression import HasCTE as HasCTE
from .sql.expression import HasPrefixes as HasPrefixes
from .sql.expression import HasSuffixes as HasSuffixes
from .sql.expression import Insert as Insert
from .sql.expression import insert as insert
from .sql.expression import intersect as intersect
from .sql.expression import intersect_all as intersect_all
from .sql.expression import Join as Join
from .sql.expression import join as join
from .sql.expression import Label as Label
from .sql.expression import label as label
from .sql.expression import LABEL_STYLE_DEFAULT as LABEL_STYLE_DEFAULT
from .sql.expression import (
    LABEL_STYLE_DISAMBIGUATE_ONLY as LABEL_STYLE_DISAMBIGUATE_ONLY,
)
from .sql.expression import LABEL_STYLE_NONE as LABEL_STYLE_NONE
from .sql.expression import (
    LABEL_STYLE_TABLENAME_PLUS_COL as LABEL_STYLE_TABLENAME_PLUS_COL,
)
from .sql.expression import lambda_stmt as lambda_stmt
from .sql.expression import LambdaElement as LambdaElement
from .sql.expression import Lateral as Lateral
from .sql.expression import lateral as lateral
from .sql.expression import literal as literal
from .sql.expression import literal_column as literal_column
from .sql.expression import modifier as modifier
from .sql.expression import not_ as not_
from .sql.expression import Null as Null
from .sql.expression import null as null
from .sql.expression import nulls_first as nulls_first
from .sql.expression import nulls_last as nulls_last
from .sql.expression import nullsfirst as nullsfirst
from .sql.expression import nullslast as nullslast
from .sql.expression import Operators as Operators
from .sql.expression import or_ as or_
from .sql.expression import outerjoin as outerjoin
from .sql.expression import outparam as outparam
from .sql.expression import Over as Over
from .sql.expression import over as over
from .sql.expression import quoted_name as quoted_name
from .sql.expression import ReleaseSavepointClause as ReleaseSavepointClause
from .sql.expression import ReturnsRows as ReturnsRows
from .sql.expression import (
    RollbackToSavepointClause as RollbackToSavepointClause,
)
from .sql.expression import SavepointClause as SavepointClause
from .sql.expression import ScalarSelect as ScalarSelect
from .sql.expression import Select as Select
from .sql.expression import select as select
from .sql.expression import Selectable as Selectable
from .sql.expression import SelectBase as SelectBase
from .sql.expression import SQLColumnExpression as SQLColumnExpression
from .sql.expression import StatementLambdaElement as StatementLambdaElement
from .sql.expression import Subquery as Subquery
from .sql.expression import table as table
from .sql.expression import TableClause as TableClause
from .sql.expression import TableSample as TableSample
from .sql.expression import tablesample as tablesample
from .sql.expression import TableValuedAlias as TableValuedAlias
from .sql.expression import text as text
from .sql.expression import TextAsFrom as TextAsFrom
from .sql.expression import TextClause as TextClause
from .sql.expression import TextualSelect as TextualSelect
from .sql.expression import true as true
from .sql.expression import True_ as True_
from .sql.expression import try_cast as try_cast
from .sql.expression import TryCast as TryCast
from .sql.expression import Tuple as Tuple
from .sql.expression import tuple_ as tuple_
from .sql.expression import type_coerce as type_coerce
from .sql.expression import TypeClause as TypeClause
from .sql.expression import TypeCoerce as TypeCoerce
from .sql.expression import UnaryExpression as UnaryExpression
from .sql.expression import union as union
from .sql.expression import union_all as union_all
from .sql.expression import Update as Update
from .sql.expression import update as update
from .sql.expression import UpdateBase as UpdateBase
from .sql.expression import Values as Values
from .sql.expression import values as values
from .sql.expression import ValuesBase as ValuesBase
from .sql.expression import Visitable as Visitable
from .sql.expression import within_group as within_group
from .sql.expression import WithinGroup as WithinGroup
from .types import ARRAY as ARRAY
from .types import BIGINT as BIGINT
from .types import BigInteger as BigInteger
from .types import BINARY as BINARY
from .types import BLOB as BLOB
from .types import BOOLEAN as BOOLEAN
from .types import Boolean as Boolean
from .types import CHAR as CHAR
from .types import CLOB as CLOB
from .types import DATE as DATE
from .types import Date as Date
from .types import DATETIME as DATETIME
from .types import DateTime as DateTime
from .types import DECIMAL as DECIMAL
from .types import DOUBLE as DOUBLE
from .types import Double as Double
from .types import DOUBLE_PRECISION as DOUBLE_PRECISION
from .types import Enum as Enum
from .types import FLOAT as FLOAT
from .types import Float as Float
from .types import INT as INT
from .types import INTEGER as INTEGER
from .types import Integer as Integer
from .types import Interval as Interval
from .types import JSON as JSON
from .types import LargeBinary as LargeBinary
from .types import NCHAR as NCHAR
from .types import NUMERIC as NUMERIC
from .types import Numeric as Numeric
from .types import NVARCHAR as NVARCHAR
from .types import PickleType as PickleType
from .types import REAL as REAL
from .types import SMALLINT as SMALLINT
from .types import SmallInteger as SmallInteger
from .types import String as String
from .types import TEXT as TEXT
from .types import Text as Text
from .types import TIME as TIME
from .types import Time as Time
from .types import TIMESTAMP as TIMESTAMP
from .types import TupleType as TupleType
from .types import TypeDecorator as TypeDecorator
from .types import Unicode as Unicode
from .types import UnicodeText as UnicodeText
from .types import UUID as UUID
from .types import Uuid as Uuid
from .types import VARBINARY as VARBINARY
from .types import VARCHAR as VARCHAR

__version__ = "2.0.25"


def __go(lcls: Any) -> None:
    _util.preloaded.import_prefix("sqlalchemy")

    from . import exc

    exc._version_token = "".join(__version__.split(".")[0:2])


__go(locals())


def __getattr__(name: str) -> Any:
    if name == "SingleonThreadPool":
        _util.warn_deprecated(
            "SingleonThreadPool was a typo in the v2 series. "
            "Please use the correct SingletonThreadPool name.",
            "2.0.24",
        )
        return SingletonThreadPool
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
