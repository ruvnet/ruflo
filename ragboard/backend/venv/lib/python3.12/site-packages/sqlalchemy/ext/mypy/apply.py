# ext/mypy/apply.py
# Copyright (C) 2021-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php

from __future__ import annotations

from typing import List
from typing import Optional
from typing import Union

from mypy.nodes import ARG_NAMED_OPT
from mypy.nodes import Argument
from mypy.nodes import AssignmentStmt
from mypy.nodes import CallExpr
from mypy.nodes import ClassDef
from mypy.nodes import MDEF
from mypy.nodes import MemberExpr
from mypy.nodes import NameExpr
from mypy.nodes import RefExpr
from mypy.nodes import StrExpr
from mypy.nodes import SymbolTableNode
from mypy.nodes import TempNode
from mypy.nodes import TypeInfo
from mypy.nodes import Var
from mypy.plugin import SemanticAnalyzerPluginInterface
from mypy.plugins.common import add_method_to_class
from mypy.types import AnyType
from mypy.types import get_proper_type
from mypy.types import Instance
from mypy.types import NoneTyp
from mypy.types import ProperType
from mypy.types import TypeOfAny
from mypy.types import UnboundType
from mypy.types import UnionType

from . import infer
from . import util
from .names import expr_to_mapped_constructor
from .names import NAMED_TYPE_SQLA_MAPPED


def apply_mypy_mapped_attr(
    cls: ClassDef,
    api: SemanticAnalyzerPluginInterface,
    item: Union[NameExpr, StrExpr],
    attributes: List[util.SQLAlchemyAttribute],
) -> None:
    if isinstance(item, NameExpr):
        name = item.name
    elif isinstance(item, StrExpr):
        name = item.value
    else:
        return None

    for stmt in cls.defs.body:
        if (
            isinstance(stmt, AssignmentStmt)
            and isinstance(stmt.lvalues[0], NameExpr)
            and stmt.lvalues[0].name == name
        ):
            break
    else:
        util.fail(api, f"Can't find mapped attribute {name}", cls)
        return None

    if stmt.type is None:
        util.fail(
            api,
            "Statement linked from _mypy_mapped_attrs has no "
            "typing information",
            stmt,
        )
        return None

    left_hand_explicit_type = get_proper_type(stmt.type)
    assert isinstance(
        left_hand_explicit_type, (Instance, UnionType, UnboundType)
    )

    attributes.append(
        util.SQLAlchemyAttribute(
            name=name,
            line=item.line,
            column=item.column,
            typ=left_hand_explicit_type,
            info=cls.info,
        )
    )

    apply_type_to_mapped_statement(
        api, stmt, stmt.lvalues[0], left_hand_explicit_type, None
    )


def re_apply_declarative_assignments(
    cls: ClassDef,
    api: SemanticAnalyzerPluginInterface,
    attributes: List[util.SQLAlchemyAttribute],
) -> None:
    """For multiple class passes, re-apply our left-hand side types as mypy
    seems to reset them in place.

    """
    mapped_attr_lookup = {attr.name: attr for attr in attributes}
    update_cls_metadata = False

    for stmt in cls.defs.body:
        # for a re-apply, all of our statements are AssignmentStmt;
        # @declared_attr calls will have been converted and this
        # currently seems to be preserved by mypy (but who knows if this
        # will change).
        if (
            isinstance(stmt, AssignmentStmt)
            and isinstance(stmt.lvalues[0], NameExpr)
            and stmt.lvalues[0].name in mapped_attr_lookup
            and isinstance(stmt.lvalues[0].node, Var)
        ):
            left_node = stmt.lvalues[0].node

            python_type_for_type = mapped_attr_lookup[
                stmt.lvalues[0].name
            ].type

            left_node_proper_type = get_proper_type(left_node.type)

            # if we have scanned an UnboundType and now there's a more
            # specific type than UnboundType, call the re-scan so we
            # can get that set up correctly
            if (
                isinstance(python_type_for_type, UnboundType)
                and not isinstance(left_node_proper_type, UnboundType)
                and (
                    isinstance(stmt.rvalue, CallExpr)
                    and isinstance(stmt.rvalue.callee, MemberExpr)
                    and isinstance(stmt.rvalue.callee.expr, NameExpr)
                    and stmt.rvalue.callee.expr.node is not None
                    and stmt.rvalue.callee.expr.node.fullname
                    == NAMED_TYPE_SQLA_MAPPED
                    and stmt.rvalue.callee.name == "_empty_constructor"
                    and isinstance(stmt.rvalue.args[0], CallExpr)
                    and isinstance(stmt.rvalue.args[0].callee, RefExpr)
                )
            ):
                new_python_type_for_type = (
                    infer.infer_type_from_right_hand_nameexpr(
                        api,
                        stmt,
                        left_node,
                        left_node_proper_type,
                        stmt.rvalue.args[0].callee,
                    )
                )

                if new_python_type_for_type is not None and not isinstance(
                    new_python_type_for_type, UnboundType
                ):
                    python_type_for_type = new_python_type_for_type

                    # update the SQLAlchemyAttribute with the better
                    # information
                    mapped_attr_lookup[
                        stmt.lvalues[0].name
                    ].type = python_type_for_type

                    update_cls_metadata = True

            if (
                not isinstance(left_node.type, Instance)
                or left_node.type.type.fullname != NAMED_TYPE_SQLA_MAPPED
            ):
                assert python_type_for_type is not None
                left_node.type = api.named_type(
                    NAMED_TYPE_SQLA_MAPPED, [python_type_for_type]
                )

    if update_cls_metadata:
        util.set_mapped_attributes(cls.info, attributes)


def apply_type_to_mapped_statement(
    api: SemanticAnalyzerPluginInterface,
    stmt: AssignmentStmt,
    lvalue: NameExpr,
    left_hand_explicit_type: Optional[ProperType],
    python_type_for_type: Optional[ProperType],
) -> None:
    """Apply the Mapped[<type>] annotation and right hand object to a
    declarative assignment statement.

    This converts a Python declarative class statement such as::

        class User(Base):
            # ...

            attrname = Column(Integer)

    To one that describes the final Python behavior to Mypy::

        class User(Base):
            # ...

            attrname : Mapped[Optional[int]] = <meaningless temp node>

    """
    left_node = lvalue.node
    assert isinstance(left_node, Var)

    # to be completely honest I have no idea what the difference between
    # left_node.type and stmt.type is, what it means if these are different
    # vs. the same, why in order to get tests to pass I have to assign
    # to stmt.type for the second case and not the first.  this is complete
    # trying every combination until it works stuff.

    if left_hand_explicit_type is not None:
        lvalue.is_inferred_def = False
        left_node.type = api.named_type(
            NAMED_TYPE_SQLA_MAPPED, [left_hand_explicit_type]
        )
    else:
        lvalue.is_inferred_def = False
        left_node.type = api.named_type(
            NAMED_TYPE_SQLA_MAPPED,
            [AnyType(TypeOfAny.special_form)]
            if python_type_for_type is None
            else [python_type_for_type],
        )

    # so to have it skip the right side totally, we can do this:
    # stmt.rvalue = TempNode(AnyType(TypeOfAny.special_form))

    # however, if we instead manufacture a new node that uses the old
    # one, then we can still get type checking for the call itself,
    # e.g. the Column, relationship() call, etc.

    # rewrite the node as:
    # <attr> : Mapped[<typ>] =
    # _sa_Mapped._empty_constructor(<original CallExpr from rvalue>)
    # the original right-hand side is maintained so it gets type checked
    # internally
    stmt.rvalue = expr_to_mapped_constructor(stmt.rvalue)

    if stmt.type is not None and python_type_for_type is not None:
        stmt.type = python_type_for_type


def add_additional_orm_attributes(
    cls: ClassDef,
    api: SemanticAnalyzerPluginInterface,
    attributes: List[util.SQLAlchemyAttribute],
) -> None:
    """Apply __init__, __table__ and other attributes to the mapped class."""

    info = util.info_for_cls(cls, api)

    if info is None:
        return

    is_base = util.get_is_base(info)

    if "__init__" not in info.names and not is_base:
        mapped_attr_names = {attr.name: attr.type for attr in attributes}

        for base in info.mro[1:-1]:
            if "sqlalchemy" not in info.metadata:
                continue

            base_cls_attributes = util.get_mapped_attributes(base, api)
            if base_cls_attributes is None:
                continue

            for attr in base_cls_attributes:
                mapped_attr_names.setdefault(attr.name, attr.type)

        arguments = []
        for name, typ in mapped_attr_names.items():
            if typ is None:
                typ = AnyType(TypeOfAny.special_form)
            arguments.append(
                Argument(
                    variable=Var(name, typ),
                    type_annotation=typ,
                    initializer=TempNode(typ),
                    kind=ARG_NAMED_OPT,
                )
            )

        add_method_to_class(api, cls, "__init__", arguments, NoneTyp())

    if "__table__" not in info.names and util.get_has_table(info):
        _apply_placeholder_attr_to_class(
            api, cls, "sqlalchemy.sql.schema.Table", "__table__"
        )
    if not is_base:
        _apply_placeholder_attr_to_class(
            api, cls, "sqlalchemy.orm.mapper.Mapper", "__mapper__"
        )


def _apply_placeholder_attr_to_class(
    api: SemanticAnalyzerPluginInterface,
    cls: ClassDef,
    qualified_name: str,
    attrname: str,
) -> None:
    sym = api.lookup_fully_qualified_or_none(qualified_name)
    if sym:
        assert isinstance(sym.node, TypeInfo)
        type_: ProperType = Instance(sym.node, [])
    else:
        type_ = AnyType(TypeOfAny.special_form)
    var = Var(attrname)
    var._fullname = cls.fullname + "." + attrname
    var.info = cls.info
    var.type = type_
    cls.info.names[attrname] = SymbolTableNode(MDEF, var)
