# ext/mypy/names.py
# Copyright (C) 2021-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php

from __future__ import annotations

from typing import Dict
from typing import List
from typing import Optional
from typing import Set
from typing import Tuple
from typing import Union

from mypy.nodes import ARG_POS
from mypy.nodes import CallExpr
from mypy.nodes import ClassDef
from mypy.nodes import Decorator
from mypy.nodes import Expression
from mypy.nodes import FuncDef
from mypy.nodes import MemberExpr
from mypy.nodes import NameExpr
from mypy.nodes import OverloadedFuncDef
from mypy.nodes import SymbolNode
from mypy.nodes import TypeAlias
from mypy.nodes import TypeInfo
from mypy.plugin import SemanticAnalyzerPluginInterface
from mypy.types import CallableType
from mypy.types import get_proper_type
from mypy.types import Instance
from mypy.types import UnboundType

from ... import util

COLUMN: int = util.symbol("COLUMN")
RELATIONSHIP: int = util.symbol("RELATIONSHIP")
REGISTRY: int = util.symbol("REGISTRY")
COLUMN_PROPERTY: int = util.symbol("COLUMN_PROPERTY")
TYPEENGINE: int = util.symbol("TYPEENGNE")
MAPPED: int = util.symbol("MAPPED")
DECLARATIVE_BASE: int = util.symbol("DECLARATIVE_BASE")
DECLARATIVE_META: int = util.symbol("DECLARATIVE_META")
MAPPED_DECORATOR: int = util.symbol("MAPPED_DECORATOR")
SYNONYM_PROPERTY: int = util.symbol("SYNONYM_PROPERTY")
COMPOSITE_PROPERTY: int = util.symbol("COMPOSITE_PROPERTY")
DECLARED_ATTR: int = util.symbol("DECLARED_ATTR")
MAPPER_PROPERTY: int = util.symbol("MAPPER_PROPERTY")
AS_DECLARATIVE: int = util.symbol("AS_DECLARATIVE")
AS_DECLARATIVE_BASE: int = util.symbol("AS_DECLARATIVE_BASE")
DECLARATIVE_MIXIN: int = util.symbol("DECLARATIVE_MIXIN")
QUERY_EXPRESSION: int = util.symbol("QUERY_EXPRESSION")

# names that must succeed with mypy.api.named_type
NAMED_TYPE_BUILTINS_OBJECT = "builtins.object"
NAMED_TYPE_BUILTINS_STR = "builtins.str"
NAMED_TYPE_BUILTINS_LIST = "builtins.list"
NAMED_TYPE_SQLA_MAPPED = "sqlalchemy.orm.base.Mapped"

_lookup: Dict[str, Tuple[int, Set[str]]] = {
    "Column": (
        COLUMN,
        {
            "sqlalchemy.sql.schema.Column",
            "sqlalchemy.sql.Column",
        },
    ),
    "Relationship": (
        RELATIONSHIP,
        {
            "sqlalchemy.orm.relationships.Relationship",
            "sqlalchemy.orm.relationships.RelationshipProperty",
            "sqlalchemy.orm.Relationship",
            "sqlalchemy.orm.RelationshipProperty",
        },
    ),
    "RelationshipProperty": (
        RELATIONSHIP,
        {
            "sqlalchemy.orm.relationships.Relationship",
            "sqlalchemy.orm.relationships.RelationshipProperty",
            "sqlalchemy.orm.Relationship",
            "sqlalchemy.orm.RelationshipProperty",
        },
    ),
    "registry": (
        REGISTRY,
        {
            "sqlalchemy.orm.decl_api.registry",
            "sqlalchemy.orm.registry",
        },
    ),
    "ColumnProperty": (
        COLUMN_PROPERTY,
        {
            "sqlalchemy.orm.properties.MappedSQLExpression",
            "sqlalchemy.orm.MappedSQLExpression",
            "sqlalchemy.orm.properties.ColumnProperty",
            "sqlalchemy.orm.ColumnProperty",
        },
    ),
    "MappedSQLExpression": (
        COLUMN_PROPERTY,
        {
            "sqlalchemy.orm.properties.MappedSQLExpression",
            "sqlalchemy.orm.MappedSQLExpression",
            "sqlalchemy.orm.properties.ColumnProperty",
            "sqlalchemy.orm.ColumnProperty",
        },
    ),
    "Synonym": (
        SYNONYM_PROPERTY,
        {
            "sqlalchemy.orm.descriptor_props.Synonym",
            "sqlalchemy.orm.Synonym",
            "sqlalchemy.orm.descriptor_props.SynonymProperty",
            "sqlalchemy.orm.SynonymProperty",
        },
    ),
    "SynonymProperty": (
        SYNONYM_PROPERTY,
        {
            "sqlalchemy.orm.descriptor_props.Synonym",
            "sqlalchemy.orm.Synonym",
            "sqlalchemy.orm.descriptor_props.SynonymProperty",
            "sqlalchemy.orm.SynonymProperty",
        },
    ),
    "Composite": (
        COMPOSITE_PROPERTY,
        {
            "sqlalchemy.orm.descriptor_props.Composite",
            "sqlalchemy.orm.Composite",
            "sqlalchemy.orm.descriptor_props.CompositeProperty",
            "sqlalchemy.orm.CompositeProperty",
        },
    ),
    "CompositeProperty": (
        COMPOSITE_PROPERTY,
        {
            "sqlalchemy.orm.descriptor_props.Composite",
            "sqlalchemy.orm.Composite",
            "sqlalchemy.orm.descriptor_props.CompositeProperty",
            "sqlalchemy.orm.CompositeProperty",
        },
    ),
    "MapperProperty": (
        MAPPER_PROPERTY,
        {
            "sqlalchemy.orm.interfaces.MapperProperty",
            "sqlalchemy.orm.MapperProperty",
        },
    ),
    "TypeEngine": (TYPEENGINE, {"sqlalchemy.sql.type_api.TypeEngine"}),
    "Mapped": (MAPPED, {NAMED_TYPE_SQLA_MAPPED}),
    "declarative_base": (
        DECLARATIVE_BASE,
        {
            "sqlalchemy.ext.declarative.declarative_base",
            "sqlalchemy.orm.declarative_base",
            "sqlalchemy.orm.decl_api.declarative_base",
        },
    ),
    "DeclarativeMeta": (
        DECLARATIVE_META,
        {
            "sqlalchemy.ext.declarative.DeclarativeMeta",
            "sqlalchemy.orm.DeclarativeMeta",
            "sqlalchemy.orm.decl_api.DeclarativeMeta",
        },
    ),
    "mapped": (
        MAPPED_DECORATOR,
        {
            "sqlalchemy.orm.decl_api.registry.mapped",
            "sqlalchemy.orm.registry.mapped",
        },
    ),
    "as_declarative": (
        AS_DECLARATIVE,
        {
            "sqlalchemy.ext.declarative.as_declarative",
            "sqlalchemy.orm.decl_api.as_declarative",
            "sqlalchemy.orm.as_declarative",
        },
    ),
    "as_declarative_base": (
        AS_DECLARATIVE_BASE,
        {
            "sqlalchemy.orm.decl_api.registry.as_declarative_base",
            "sqlalchemy.orm.registry.as_declarative_base",
        },
    ),
    "declared_attr": (
        DECLARED_ATTR,
        {
            "sqlalchemy.orm.decl_api.declared_attr",
            "sqlalchemy.orm.declared_attr",
        },
    ),
    "declarative_mixin": (
        DECLARATIVE_MIXIN,
        {
            "sqlalchemy.orm.decl_api.declarative_mixin",
            "sqlalchemy.orm.declarative_mixin",
        },
    ),
    "query_expression": (
        QUERY_EXPRESSION,
        {
            "sqlalchemy.orm.query_expression",
            "sqlalchemy.orm._orm_constructors.query_expression",
        },
    ),
}


def has_base_type_id(info: TypeInfo, type_id: int) -> bool:
    for mr in info.mro:
        check_type_id, fullnames = _lookup.get(mr.name, (None, None))
        if check_type_id == type_id:
            break
    else:
        return False

    if fullnames is None:
        return False

    return mr.fullname in fullnames


def mro_has_id(mro: List[TypeInfo], type_id: int) -> bool:
    for mr in mro:
        check_type_id, fullnames = _lookup.get(mr.name, (None, None))
        if check_type_id == type_id:
            break
    else:
        return False

    if fullnames is None:
        return False

    return mr.fullname in fullnames


def type_id_for_unbound_type(
    type_: UnboundType, cls: ClassDef, api: SemanticAnalyzerPluginInterface
) -> Optional[int]:
    sym = api.lookup_qualified(type_.name, type_)
    if sym is not None:
        if isinstance(sym.node, TypeAlias):
            target_type = get_proper_type(sym.node.target)
            if isinstance(target_type, Instance):
                return type_id_for_named_node(target_type.type)
        elif isinstance(sym.node, TypeInfo):
            return type_id_for_named_node(sym.node)

    return None


def type_id_for_callee(callee: Expression) -> Optional[int]:
    if isinstance(callee, (MemberExpr, NameExpr)):
        if isinstance(callee.node, Decorator) and isinstance(
            callee.node.func, FuncDef
        ):
            if callee.node.func.type and isinstance(
                callee.node.func.type, CallableType
            ):
                ret_type = get_proper_type(callee.node.func.type.ret_type)

                if isinstance(ret_type, Instance):
                    return type_id_for_fullname(ret_type.type.fullname)

            return None

        elif isinstance(callee.node, OverloadedFuncDef):
            if (
                callee.node.impl
                and callee.node.impl.type
                and isinstance(callee.node.impl.type, CallableType)
            ):
                ret_type = get_proper_type(callee.node.impl.type.ret_type)

                if isinstance(ret_type, Instance):
                    return type_id_for_fullname(ret_type.type.fullname)

            return None
        elif isinstance(callee.node, FuncDef):
            if callee.node.type and isinstance(callee.node.type, CallableType):
                ret_type = get_proper_type(callee.node.type.ret_type)

                if isinstance(ret_type, Instance):
                    return type_id_for_fullname(ret_type.type.fullname)

            return None
        elif isinstance(callee.node, TypeAlias):
            target_type = get_proper_type(callee.node.target)
            if isinstance(target_type, Instance):
                return type_id_for_fullname(target_type.type.fullname)
        elif isinstance(callee.node, TypeInfo):
            return type_id_for_named_node(callee)
    return None


def type_id_for_named_node(
    node: Union[NameExpr, MemberExpr, SymbolNode]
) -> Optional[int]:
    type_id, fullnames = _lookup.get(node.name, (None, None))

    if type_id is None or fullnames is None:
        return None
    elif node.fullname in fullnames:
        return type_id
    else:
        return None


def type_id_for_fullname(fullname: str) -> Optional[int]:
    tokens = fullname.split(".")
    immediate = tokens[-1]

    type_id, fullnames = _lookup.get(immediate, (None, None))

    if type_id is None or fullnames is None:
        return None
    elif fullname in fullnames:
        return type_id
    else:
        return None


def expr_to_mapped_constructor(expr: Expression) -> CallExpr:
    column_descriptor = NameExpr("__sa_Mapped")
    column_descriptor.fullname = NAMED_TYPE_SQLA_MAPPED
    member_expr = MemberExpr(column_descriptor, "_empty_constructor")
    return CallExpr(
        member_expr,
        [expr],
        [ARG_POS],
        ["arg1"],
    )
