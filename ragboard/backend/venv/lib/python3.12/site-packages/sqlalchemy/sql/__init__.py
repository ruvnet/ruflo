# sql/__init__.py
# Copyright (C) 2005-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php
from typing import Any
from typing import TYPE_CHECKING

from ._typing import ColumnExpressionArgument as ColumnExpressionArgument
from ._typing import NotNullable as NotNullable
from ._typing import Nullable as Nullable
from .base import Executable as Executable
from .compiler import COLLECT_CARTESIAN_PRODUCTS as COLLECT_CARTESIAN_PRODUCTS
from .compiler import FROM_LINTING as FROM_LINTING
from .compiler import NO_LINTING as NO_LINTING
from .compiler import WARN_LINTING as WARN_LINTING
from .ddl import BaseDDLElement as BaseDDLElement
from .ddl import DDL as DDL
from .ddl import DDLElement as DDLElement
from .ddl import ExecutableDDLElement as ExecutableDDLElement
from .expression import Alias as Alias
from .expression import alias as alias
from .expression import all_ as all_
from .expression import and_ as and_
from .expression import any_ as any_
from .expression import asc as asc
from .expression import between as between
from .expression import bindparam as bindparam
from .expression import case as case
from .expression import cast as cast
from .expression import ClauseElement as ClauseElement
from .expression import collate as collate
from .expression import column as column
from .expression import ColumnCollection as ColumnCollection
from .expression import ColumnElement as ColumnElement
from .expression import CompoundSelect as CompoundSelect
from .expression import cte as cte
from .expression import Delete as Delete
from .expression import delete as delete
from .expression import desc as desc
from .expression import distinct as distinct
from .expression import except_ as except_
from .expression import except_all as except_all
from .expression import exists as exists
from .expression import extract as extract
from .expression import false as false
from .expression import False_ as False_
from .expression import FromClause as FromClause
from .expression import func as func
from .expression import funcfilter as funcfilter
from .expression import Insert as Insert
from .expression import insert as insert
from .expression import intersect as intersect
from .expression import intersect_all as intersect_all
from .expression import Join as Join
from .expression import join as join
from .expression import label as label
from .expression import LABEL_STYLE_DEFAULT as LABEL_STYLE_DEFAULT
from .expression import (
    LABEL_STYLE_DISAMBIGUATE_ONLY as LABEL_STYLE_DISAMBIGUATE_ONLY,
)
from .expression import LABEL_STYLE_NONE as LABEL_STYLE_NONE
from .expression import (
    LABEL_STYLE_TABLENAME_PLUS_COL as LABEL_STYLE_TABLENAME_PLUS_COL,
)
from .expression import lambda_stmt as lambda_stmt
from .expression import LambdaElement as LambdaElement
from .expression import lateral as lateral
from .expression import literal as literal
from .expression import literal_column as literal_column
from .expression import modifier as modifier
from .expression import not_ as not_
from .expression import null as null
from .expression import nulls_first as nulls_first
from .expression import nulls_last as nulls_last
from .expression import nullsfirst as nullsfirst
from .expression import nullslast as nullslast
from .expression import or_ as or_
from .expression import outerjoin as outerjoin
from .expression import outparam as outparam
from .expression import over as over
from .expression import quoted_name as quoted_name
from .expression import Select as Select
from .expression import select as select
from .expression import Selectable as Selectable
from .expression import SelectLabelStyle as SelectLabelStyle
from .expression import SQLColumnExpression as SQLColumnExpression
from .expression import StatementLambdaElement as StatementLambdaElement
from .expression import Subquery as Subquery
from .expression import table as table
from .expression import TableClause as TableClause
from .expression import TableSample as TableSample
from .expression import tablesample as tablesample
from .expression import text as text
from .expression import true as true
from .expression import True_ as True_
from .expression import try_cast as try_cast
from .expression import tuple_ as tuple_
from .expression import type_coerce as type_coerce
from .expression import union as union
from .expression import union_all as union_all
from .expression import Update as Update
from .expression import update as update
from .expression import Values as Values
from .expression import values as values
from .expression import within_group as within_group
from .visitors import ClauseVisitor as ClauseVisitor


def __go(lcls: Any) -> None:
    from .. import util as _sa_util

    from . import base
    from . import coercions
    from . import elements
    from . import lambdas
    from . import selectable
    from . import schema
    from . import traversals
    from . import type_api

    if not TYPE_CHECKING:
        base.coercions = elements.coercions = coercions
        base.elements = elements
        base.type_api = type_api
        coercions.elements = elements
        coercions.lambdas = lambdas
        coercions.schema = schema
        coercions.selectable = selectable

    from .annotation import _prepare_annotations
    from .annotation import Annotated
    from .elements import AnnotatedColumnElement
    from .elements import ClauseList
    from .selectable import AnnotatedFromClause

    _prepare_annotations(ColumnElement, AnnotatedColumnElement)
    _prepare_annotations(FromClause, AnnotatedFromClause)
    _prepare_annotations(ClauseList, Annotated)

    _sa_util.preloaded.import_prefix("sqlalchemy.sql")


__go(locals())
