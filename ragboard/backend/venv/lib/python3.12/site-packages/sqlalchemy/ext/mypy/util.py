# ext/mypy/util.py
# Copyright (C) 2021-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php

from __future__ import annotations

import re
from typing import Any
from typing import Iterable
from typing import Iterator
from typing import List
from typing import Optional
from typing import overload
from typing import Tuple
from typing import Type as TypingType
from typing import TypeVar
from typing import Union

from mypy import version
from mypy.messages import format_type as _mypy_format_type
from mypy.nodes import CallExpr
from mypy.nodes import ClassDef
from mypy.nodes import CLASSDEF_NO_INFO
from mypy.nodes import Context
from mypy.nodes import Expression
from mypy.nodes import FuncDef
from mypy.nodes import IfStmt
from mypy.nodes import JsonDict
from mypy.nodes import MemberExpr
from mypy.nodes import NameExpr
from mypy.nodes import Statement
from mypy.nodes import SymbolTableNode
from mypy.nodes import TypeAlias
from mypy.nodes import TypeInfo
from mypy.options import Options
from mypy.plugin import ClassDefContext
from mypy.plugin import DynamicClassDefContext
from mypy.plugin import SemanticAnalyzerPluginInterface
from mypy.plugins.common import deserialize_and_fixup_type
from mypy.typeops import map_type_from_supertype
from mypy.types import CallableType
from mypy.types import get_proper_type
from mypy.types import Instance
from mypy.types import NoneType
from mypy.types import Type
from mypy.types import TypeVarType
from mypy.types import UnboundType
from mypy.types import UnionType

_vers = tuple(
    [int(x) for x in version.__version__.split(".") if re.match(r"^\d+$", x)]
)
mypy_14 = _vers >= (1, 4)


_TArgType = TypeVar("_TArgType", bound=Union[CallExpr, NameExpr])


class SQLAlchemyAttribute:
    def __init__(
        self,
        name: str,
        line: int,
        column: int,
        typ: Optional[Type],
        info: TypeInfo,
    ) -> None:
        self.name = name
        self.line = line
        self.column = column
        self.type = typ
        self.info = info

    def serialize(self) -> JsonDict:
        assert self.type
        return {
            "name": self.name,
            "line": self.line,
            "column": self.column,
            "type": self.type.serialize(),
        }

    def expand_typevar_from_subtype(self, sub_type: TypeInfo) -> None:
        """Expands type vars in the context of a subtype when an attribute is
        inherited from a generic super type.
        """
        if not isinstance(self.type, TypeVarType):
            return

        self.type = map_type_from_supertype(self.type, sub_type, self.info)

    @classmethod
    def deserialize(
        cls,
        info: TypeInfo,
        data: JsonDict,
        api: SemanticAnalyzerPluginInterface,
    ) -> SQLAlchemyAttribute:
        data = data.copy()
        typ = deserialize_and_fixup_type(data.pop("type"), api)
        return cls(typ=typ, info=info, **data)


def name_is_dunder(name: str) -> bool:
    return bool(re.match(r"^__.+?__$", name))


def _set_info_metadata(info: TypeInfo, key: str, data: Any) -> None:
    info.metadata.setdefault("sqlalchemy", {})[key] = data


def _get_info_metadata(info: TypeInfo, key: str) -> Optional[Any]:
    return info.metadata.get("sqlalchemy", {}).get(key, None)


def _get_info_mro_metadata(info: TypeInfo, key: str) -> Optional[Any]:
    if info.mro:
        for base in info.mro:
            metadata = _get_info_metadata(base, key)
            if metadata is not None:
                return metadata
    return None


def establish_as_sqlalchemy(info: TypeInfo) -> None:
    info.metadata.setdefault("sqlalchemy", {})


def set_is_base(info: TypeInfo) -> None:
    _set_info_metadata(info, "is_base", True)


def get_is_base(info: TypeInfo) -> bool:
    is_base = _get_info_metadata(info, "is_base")
    return is_base is True


def has_declarative_base(info: TypeInfo) -> bool:
    is_base = _get_info_mro_metadata(info, "is_base")
    return is_base is True


def set_has_table(info: TypeInfo) -> None:
    _set_info_metadata(info, "has_table", True)


def get_has_table(info: TypeInfo) -> bool:
    is_base = _get_info_metadata(info, "has_table")
    return is_base is True


def get_mapped_attributes(
    info: TypeInfo, api: SemanticAnalyzerPluginInterface
) -> Optional[List[SQLAlchemyAttribute]]:
    mapped_attributes: Optional[List[JsonDict]] = _get_info_metadata(
        info, "mapped_attributes"
    )
    if mapped_attributes is None:
        return None

    attributes: List[SQLAlchemyAttribute] = []

    for data in mapped_attributes:
        attr = SQLAlchemyAttribute.deserialize(info, data, api)
        attr.expand_typevar_from_subtype(info)
        attributes.append(attr)

    return attributes


def format_type(typ_: Type, options: Options) -> str:
    if mypy_14:
        return _mypy_format_type(typ_, options)
    else:
        return _mypy_format_type(typ_)  # type: ignore


def set_mapped_attributes(
    info: TypeInfo, attributes: List[SQLAlchemyAttribute]
) -> None:
    _set_info_metadata(
        info,
        "mapped_attributes",
        [attribute.serialize() for attribute in attributes],
    )


def fail(api: SemanticAnalyzerPluginInterface, msg: str, ctx: Context) -> None:
    msg = "[SQLAlchemy Mypy plugin] %s" % msg
    return api.fail(msg, ctx)


def add_global(
    ctx: Union[ClassDefContext, DynamicClassDefContext],
    module: str,
    symbol_name: str,
    asname: str,
) -> None:
    module_globals = ctx.api.modules[ctx.api.cur_mod_id].names

    if asname not in module_globals:
        lookup_sym: SymbolTableNode = ctx.api.modules[module].names[
            symbol_name
        ]

        module_globals[asname] = lookup_sym


@overload
def get_callexpr_kwarg(
    callexpr: CallExpr, name: str, *, expr_types: None = ...
) -> Optional[Union[CallExpr, NameExpr]]:
    ...


@overload
def get_callexpr_kwarg(
    callexpr: CallExpr,
    name: str,
    *,
    expr_types: Tuple[TypingType[_TArgType], ...],
) -> Optional[_TArgType]:
    ...


def get_callexpr_kwarg(
    callexpr: CallExpr,
    name: str,
    *,
    expr_types: Optional[Tuple[TypingType[Any], ...]] = None,
) -> Optional[Any]:
    try:
        arg_idx = callexpr.arg_names.index(name)
    except ValueError:
        return None

    kwarg = callexpr.args[arg_idx]
    if isinstance(
        kwarg, expr_types if expr_types is not None else (NameExpr, CallExpr)
    ):
        return kwarg

    return None


def flatten_typechecking(stmts: Iterable[Statement]) -> Iterator[Statement]:
    for stmt in stmts:
        if (
            isinstance(stmt, IfStmt)
            and isinstance(stmt.expr[0], NameExpr)
            and stmt.expr[0].fullname == "typing.TYPE_CHECKING"
        ):
            yield from stmt.body[0].body
        else:
            yield stmt


def type_for_callee(callee: Expression) -> Optional[Union[Instance, TypeInfo]]:
    if isinstance(callee, (MemberExpr, NameExpr)):
        if isinstance(callee.node, FuncDef):
            if callee.node.type and isinstance(callee.node.type, CallableType):
                ret_type = get_proper_type(callee.node.type.ret_type)

                if isinstance(ret_type, Instance):
                    return ret_type

            return None
        elif isinstance(callee.node, TypeAlias):
            target_type = get_proper_type(callee.node.target)
            if isinstance(target_type, Instance):
                return target_type
        elif isinstance(callee.node, TypeInfo):
            return callee.node
    return None


def unbound_to_instance(
    api: SemanticAnalyzerPluginInterface, typ: Type
) -> Type:
    """Take the UnboundType that we seem to get as the ret_type from a FuncDef
    and convert it into an Instance/TypeInfo kind of structure that seems
    to work as the left-hand type of an AssignmentStatement.

    """

    if not isinstance(typ, UnboundType):
        return typ

    # TODO: figure out a more robust way to check this.  The node is some
    # kind of _SpecialForm, there's a typing.Optional that's _SpecialForm,
    # but I can't figure out how to get them to match up
    if typ.name == "Optional":
        # convert from "Optional?" to the more familiar
        # UnionType[..., NoneType()]
        return unbound_to_instance(
            api,
            UnionType(
                [unbound_to_instance(api, typ_arg) for typ_arg in typ.args]
                + [NoneType()]
            ),
        )

    node = api.lookup_qualified(typ.name, typ)

    if (
        node is not None
        and isinstance(node, SymbolTableNode)
        and isinstance(node.node, TypeInfo)
    ):
        bound_type = node.node

        return Instance(
            bound_type,
            [
                unbound_to_instance(api, arg)
                if isinstance(arg, UnboundType)
                else arg
                for arg in typ.args
            ],
        )
    else:
        return typ


def info_for_cls(
    cls: ClassDef, api: SemanticAnalyzerPluginInterface
) -> Optional[TypeInfo]:
    if cls.info is CLASSDEF_NO_INFO:
        sym = api.lookup_qualified(cls.name, cls)
        if sym is None:
            return None
        assert sym and isinstance(sym.node, TypeInfo)
        return sym.node

    return cls.info
