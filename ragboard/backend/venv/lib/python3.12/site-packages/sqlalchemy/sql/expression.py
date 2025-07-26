# sql/expression.py
# Copyright (C) 2005-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php

"""Defines the public namespace for SQL expression constructs.


"""


from __future__ import annotations

from ._dml_constructors import delete as delete
from ._dml_constructors import insert as insert
from ._dml_constructors import update as update
from ._elements_constructors import all_ as all_
from ._elements_constructors import and_ as and_
from ._elements_constructors import any_ as any_
from ._elements_constructors import asc as asc
from ._elements_constructors import between as between
from ._elements_constructors import bindparam as bindparam
from ._elements_constructors import bitwise_not as bitwise_not
from ._elements_constructors import case as case
from ._elements_constructors import cast as cast
from ._elements_constructors import collate as collate
from ._elements_constructors import column as column
from ._elements_constructors import desc as desc
from ._elements_constructors import distinct as distinct
from ._elements_constructors import extract as extract
from ._elements_constructors import false as false
from ._elements_constructors import funcfilter as funcfilter
from ._elements_constructors import label as label
from ._elements_constructors import not_ as not_
from ._elements_constructors import null as null
from ._elements_constructors import nulls_first as nulls_first
from ._elements_constructors import nulls_last as nulls_last
from ._elements_constructors import or_ as or_
from ._elements_constructors import outparam as outparam
from ._elements_constructors import over as over
from ._elements_constructors import text as text
from ._elements_constructors import true as true
from ._elements_constructors import try_cast as try_cast
from ._elements_constructors import tuple_ as tuple_
from ._elements_constructors import type_coerce as type_coerce
from ._elements_constructors import within_group as within_group
from ._selectable_constructors import alias as alias
from ._selectable_constructors import cte as cte
from ._selectable_constructors import except_ as except_
from ._selectable_constructors import except_all as except_all
from ._selectable_constructors import exists as exists
from ._selectable_constructors import intersect as intersect
from ._selectable_constructors import intersect_all as intersect_all
from ._selectable_constructors import join as join
from ._selectable_constructors import lateral as lateral
from ._selectable_constructors import outerjoin as outerjoin
from ._selectable_constructors import select as select
from ._selectable_constructors import table as table
from ._selectable_constructors import tablesample as tablesample
from ._selectable_constructors import union as union
from ._selectable_constructors import union_all as union_all
from ._selectable_constructors import values as values
from ._typing import ColumnExpressionArgument as ColumnExpressionArgument
from .base import _from_objects as _from_objects
from .base import _select_iterables as _select_iterables
from .base import ColumnCollection as ColumnCollection
from .base import Executable as Executable
from .cache_key import CacheKey as CacheKey
from .dml import Delete as Delete
from .dml import Insert as Insert
from .dml import Update as Update
from .dml import UpdateBase as UpdateBase
from .dml import ValuesBase as ValuesBase
from .elements import _truncated_label as _truncated_label
from .elements import BinaryExpression as BinaryExpression
from .elements import BindParameter as BindParameter
from .elements import BooleanClauseList as BooleanClauseList
from .elements import Case as Case
from .elements import Cast as Cast
from .elements import ClauseElement as ClauseElement
from .elements import ClauseList as ClauseList
from .elements import CollectionAggregate as CollectionAggregate
from .elements import ColumnClause as ColumnClause
from .elements import ColumnElement as ColumnElement
from .elements import ExpressionClauseList as ExpressionClauseList
from .elements import Extract as Extract
from .elements import False_ as False_
from .elements import FunctionFilter as FunctionFilter
from .elements import Grouping as Grouping
from .elements import Label as Label
from .elements import literal as literal
from .elements import literal_column as literal_column
from .elements import Null as Null
from .elements import Over as Over
from .elements import quoted_name as quoted_name
from .elements import ReleaseSavepointClause as ReleaseSavepointClause
from .elements import RollbackToSavepointClause as RollbackToSavepointClause
from .elements import SavepointClause as SavepointClause
from .elements import SQLColumnExpression as SQLColumnExpression
from .elements import TextClause as TextClause
from .elements import True_ as True_
from .elements import TryCast as TryCast
from .elements import Tuple as Tuple
from .elements import TypeClause as TypeClause
from .elements import TypeCoerce as TypeCoerce
from .elements import UnaryExpression as UnaryExpression
from .elements import WithinGroup as WithinGroup
from .functions import func as func
from .functions import Function as Function
from .functions import FunctionElement as FunctionElement
from .functions import modifier as modifier
from .lambdas import lambda_stmt as lambda_stmt
from .lambdas import LambdaElement as LambdaElement
from .lambdas import StatementLambdaElement as StatementLambdaElement
from .operators import ColumnOperators as ColumnOperators
from .operators import custom_op as custom_op
from .operators import Operators as Operators
from .selectable import Alias as Alias
from .selectable import AliasedReturnsRows as AliasedReturnsRows
from .selectable import CompoundSelect as CompoundSelect
from .selectable import CTE as CTE
from .selectable import Exists as Exists
from .selectable import FromClause as FromClause
from .selectable import FromGrouping as FromGrouping
from .selectable import GenerativeSelect as GenerativeSelect
from .selectable import HasCTE as HasCTE
from .selectable import HasPrefixes as HasPrefixes
from .selectable import HasSuffixes as HasSuffixes
from .selectable import Join as Join
from .selectable import LABEL_STYLE_DEFAULT as LABEL_STYLE_DEFAULT
from .selectable import (
    LABEL_STYLE_DISAMBIGUATE_ONLY as LABEL_STYLE_DISAMBIGUATE_ONLY,
)
from .selectable import LABEL_STYLE_NONE as LABEL_STYLE_NONE
from .selectable import (
    LABEL_STYLE_TABLENAME_PLUS_COL as LABEL_STYLE_TABLENAME_PLUS_COL,
)
from .selectable import Lateral as Lateral
from .selectable import ReturnsRows as ReturnsRows
from .selectable import ScalarSelect as ScalarSelect
from .selectable import ScalarValues as ScalarValues
from .selectable import Select as Select
from .selectable import Selectable as Selectable
from .selectable import SelectBase as SelectBase
from .selectable import SelectLabelStyle as SelectLabelStyle
from .selectable import Subquery as Subquery
from .selectable import TableClause as TableClause
from .selectable import TableSample as TableSample
from .selectable import TableValuedAlias as TableValuedAlias
from .selectable import TextAsFrom as TextAsFrom
from .selectable import TextualSelect as TextualSelect
from .selectable import Values as Values
from .visitors import Visitable as Visitable

nullsfirst = nulls_first
"""Synonym for the :func:`.nulls_first` function."""


nullslast = nulls_last
"""Synonym for the :func:`.nulls_last` function."""
