# util/typing.py
# Copyright (C) 2022-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php
# mypy: allow-untyped-defs, allow-untyped-calls

from __future__ import annotations

import builtins
import collections.abc as collections_abc
import re
import sys
import typing
from typing import Any
from typing import Callable
from typing import cast
from typing import Dict
from typing import ForwardRef
from typing import Generic
from typing import Iterable
from typing import Mapping
from typing import NewType
from typing import NoReturn
from typing import Optional
from typing import overload
from typing import Set
from typing import Tuple
from typing import Type
from typing import TYPE_CHECKING
from typing import TypeVar
from typing import Union

from . import compat

if True:  # zimports removes the tailing comments
    from typing_extensions import Annotated as Annotated  # 3.8
    from typing_extensions import Concatenate as Concatenate  # 3.10
    from typing_extensions import (
        dataclass_transform as dataclass_transform,  # 3.11,
    )
    from typing_extensions import Final as Final  # 3.8
    from typing_extensions import final as final  # 3.8
    from typing_extensions import get_args as get_args  # 3.10
    from typing_extensions import get_origin as get_origin  # 3.10
    from typing_extensions import Literal as Literal  # 3.8
    from typing_extensions import NotRequired as NotRequired  # 3.11
    from typing_extensions import ParamSpec as ParamSpec  # 3.10
    from typing_extensions import Protocol as Protocol  # 3.8
    from typing_extensions import SupportsIndex as SupportsIndex  # 3.8
    from typing_extensions import TypeAlias as TypeAlias  # 3.10
    from typing_extensions import TypedDict as TypedDict  # 3.8
    from typing_extensions import TypeGuard as TypeGuard  # 3.10
    from typing_extensions import Self as Self  # 3.11
    from typing_extensions import TypeAliasType as TypeAliasType  # 3.12

_T = TypeVar("_T", bound=Any)
_KT = TypeVar("_KT")
_KT_co = TypeVar("_KT_co", covariant=True)
_KT_contra = TypeVar("_KT_contra", contravariant=True)
_VT = TypeVar("_VT")
_VT_co = TypeVar("_VT_co", covariant=True)


if compat.py310:
    # why they took until py310 to put this in stdlib is beyond me,
    # I've been wanting it since py27
    from types import NoneType as NoneType
else:
    NoneType = type(None)  # type: ignore

NoneFwd = ForwardRef("None")

typing_get_args = get_args
typing_get_origin = get_origin


_AnnotationScanType = Union[
    Type[Any], str, ForwardRef, NewType, TypeAliasType, "GenericProtocol[Any]"
]


class ArgsTypeProcotol(Protocol):
    """protocol for types that have ``__args__``

    there's no public interface for this AFAIK

    """

    __args__: Tuple[_AnnotationScanType, ...]


class GenericProtocol(Protocol[_T]):
    """protocol for generic types.

    this since Python.typing _GenericAlias is private

    """

    __args__: Tuple[_AnnotationScanType, ...]
    __origin__: Type[_T]

    # Python's builtin _GenericAlias has this method, however builtins like
    # list, dict, etc. do not, even though they have ``__origin__`` and
    # ``__args__``
    #
    # def copy_with(self, params: Tuple[_AnnotationScanType, ...]) -> Type[_T]:
    #     ...


# copied from TypeShed, required in order to implement
# MutableMapping.update()
class SupportsKeysAndGetItem(Protocol[_KT, _VT_co]):
    def keys(self) -> Iterable[_KT]:
        ...

    def __getitem__(self, __k: _KT) -> _VT_co:
        ...


# work around https://github.com/microsoft/pyright/issues/3025
_LiteralStar = Literal["*"]


def de_stringify_annotation(
    cls: Type[Any],
    annotation: _AnnotationScanType,
    originating_module: str,
    locals_: Mapping[str, Any],
    *,
    str_cleanup_fn: Optional[Callable[[str, str], str]] = None,
    include_generic: bool = False,
    _already_seen: Optional[Set[Any]] = None,
) -> Type[Any]:
    """Resolve annotations that may be string based into real objects.

    This is particularly important if a module defines "from __future__ import
    annotations", as everything inside of __annotations__ is a string. We want
    to at least have generic containers like ``Mapped``, ``Union``, ``List``,
    etc.

    """
    # looked at typing.get_type_hints(), looked at pydantic.  We need much
    # less here, and we here try to not use any private typing internals
    # or construct ForwardRef objects which is documented as something
    # that should be avoided.

    original_annotation = annotation

    if is_fwd_ref(annotation):
        annotation = annotation.__forward_arg__

    if isinstance(annotation, str):
        if str_cleanup_fn:
            annotation = str_cleanup_fn(annotation, originating_module)

        annotation = eval_expression(
            annotation, originating_module, locals_=locals_
        )

    if (
        include_generic
        and is_generic(annotation)
        and not is_literal(annotation)
    ):
        if _already_seen is None:
            _already_seen = set()

        if annotation in _already_seen:
            # only occurs recursively.  outermost return type
            # will always be Type.
            # the element here will be either ForwardRef or
            # Optional[ForwardRef]
            return original_annotation  # type: ignore
        else:
            _already_seen.add(annotation)

        elements = tuple(
            de_stringify_annotation(
                cls,
                elem,
                originating_module,
                locals_,
                str_cleanup_fn=str_cleanup_fn,
                include_generic=include_generic,
                _already_seen=_already_seen,
            )
            for elem in annotation.__args__
        )

        return _copy_generic_annotation_with(annotation, elements)
    return annotation  # type: ignore


def _copy_generic_annotation_with(
    annotation: GenericProtocol[_T], elements: Tuple[_AnnotationScanType, ...]
) -> Type[_T]:
    if hasattr(annotation, "copy_with"):
        # List, Dict, etc. real generics
        return annotation.copy_with(elements)  # type: ignore
    else:
        # Python builtins list, dict, etc.
        return annotation.__origin__[elements]  # type: ignore


def eval_expression(
    expression: str,
    module_name: str,
    *,
    locals_: Optional[Mapping[str, Any]] = None,
) -> Any:
    try:
        base_globals: Dict[str, Any] = sys.modules[module_name].__dict__
    except KeyError as ke:
        raise NameError(
            f"Module {module_name} isn't present in sys.modules; can't "
            f"evaluate expression {expression}"
        ) from ke

    try:
        annotation = eval(expression, base_globals, locals_)
    except Exception as err:
        raise NameError(
            f"Could not de-stringify annotation {expression!r}"
        ) from err
    else:
        return annotation


def eval_name_only(
    name: str,
    module_name: str,
    *,
    locals_: Optional[Mapping[str, Any]] = None,
) -> Any:
    if "." in name:
        return eval_expression(name, module_name, locals_=locals_)

    try:
        base_globals: Dict[str, Any] = sys.modules[module_name].__dict__
    except KeyError as ke:
        raise NameError(
            f"Module {module_name} isn't present in sys.modules; can't "
            f"resolve name {name}"
        ) from ke

    # name only, just look in globals.  eval() works perfectly fine here,
    # however we are seeking to have this be faster, as this occurs for
    # every Mapper[] keyword, etc. depending on configuration
    try:
        return base_globals[name]
    except KeyError as ke:
        # check in builtins as well to handle `list`, `set` or `dict`, etc.
        try:
            return builtins.__dict__[name]
        except KeyError:
            pass

        raise NameError(
            f"Could not locate name {name} in module {module_name}"
        ) from ke


def resolve_name_to_real_class_name(name: str, module_name: str) -> str:
    try:
        obj = eval_name_only(name, module_name)
    except NameError:
        return name
    else:
        return getattr(obj, "__name__", name)


def de_stringify_union_elements(
    cls: Type[Any],
    annotation: ArgsTypeProcotol,
    originating_module: str,
    locals_: Mapping[str, Any],
    *,
    str_cleanup_fn: Optional[Callable[[str, str], str]] = None,
) -> Type[Any]:
    return make_union_type(
        *[
            de_stringify_annotation(
                cls,
                anno,
                originating_module,
                {},
                str_cleanup_fn=str_cleanup_fn,
            )
            for anno in annotation.__args__
        ]
    )


def is_pep593(type_: Optional[_AnnotationScanType]) -> bool:
    return type_ is not None and typing_get_origin(type_) is Annotated


def is_non_string_iterable(obj: Any) -> TypeGuard[Iterable[Any]]:
    return isinstance(obj, collections_abc.Iterable) and not isinstance(
        obj, (str, bytes)
    )


def is_literal(type_: _AnnotationScanType) -> bool:
    return get_origin(type_) is Literal


def is_newtype(type_: Optional[_AnnotationScanType]) -> TypeGuard[NewType]:
    return hasattr(type_, "__supertype__")

    # doesn't work in 3.8, 3.7 as it passes a closure, not an
    # object instance
    # return isinstance(type_, NewType)


def is_generic(type_: _AnnotationScanType) -> TypeGuard[GenericProtocol[Any]]:
    return hasattr(type_, "__args__") and hasattr(type_, "__origin__")


def is_pep695(type_: _AnnotationScanType) -> TypeGuard[TypeAliasType]:
    return isinstance(type_, TypeAliasType)


def flatten_newtype(type_: NewType) -> Type[Any]:
    super_type = type_.__supertype__
    while is_newtype(super_type):
        super_type = super_type.__supertype__
    return super_type


def is_fwd_ref(
    type_: _AnnotationScanType, check_generic: bool = False
) -> TypeGuard[ForwardRef]:
    if isinstance(type_, ForwardRef):
        return True
    elif check_generic and is_generic(type_):
        return any(is_fwd_ref(arg, True) for arg in type_.__args__)
    else:
        return False


@overload
def de_optionalize_union_types(type_: str) -> str:
    ...


@overload
def de_optionalize_union_types(type_: Type[Any]) -> Type[Any]:
    ...


@overload
def de_optionalize_union_types(
    type_: _AnnotationScanType,
) -> _AnnotationScanType:
    ...


def de_optionalize_union_types(
    type_: _AnnotationScanType,
) -> _AnnotationScanType:
    """Given a type, filter out ``Union`` types that include ``NoneType``
    to not include the ``NoneType``.

    """

    if is_fwd_ref(type_):
        return de_optionalize_fwd_ref_union_types(type_)

    elif is_optional(type_):
        typ = set(type_.__args__)

        typ.discard(NoneType)
        typ.discard(NoneFwd)

        return make_union_type(*typ)

    else:
        return type_


def de_optionalize_fwd_ref_union_types(
    type_: ForwardRef,
) -> _AnnotationScanType:
    """return the non-optional type for Optional[], Union[None, ...], x|None,
    etc. without de-stringifying forward refs.

    unfortunately this seems to require lots of hardcoded heuristics

    """

    annotation = type_.__forward_arg__

    mm = re.match(r"^(.+?)\[(.+)\]$", annotation)
    if mm:
        if mm.group(1) == "Optional":
            return ForwardRef(mm.group(2))
        elif mm.group(1) == "Union":
            elements = re.split(r",\s*", mm.group(2))
            return make_union_type(
                *[ForwardRef(elem) for elem in elements if elem != "None"]
            )
        else:
            return type_

    pipe_tokens = re.split(r"\s*\|\s*", annotation)
    if "None" in pipe_tokens:
        return ForwardRef("|".join(p for p in pipe_tokens if p != "None"))

    return type_


def make_union_type(*types: _AnnotationScanType) -> Type[Any]:
    """Make a Union type.

    This is needed by :func:`.de_optionalize_union_types` which removes
    ``NoneType`` from a ``Union``.

    """
    return cast(Any, Union).__getitem__(types)  # type: ignore


def expand_unions(
    type_: Type[Any], include_union: bool = False, discard_none: bool = False
) -> Tuple[Type[Any], ...]:
    """Return a type as a tuple of individual types, expanding for
    ``Union`` types."""

    if is_union(type_):
        typ = set(type_.__args__)

        if discard_none:
            typ.discard(NoneType)

        if include_union:
            return (type_,) + tuple(typ)  # type: ignore
        else:
            return tuple(typ)  # type: ignore
    else:
        return (type_,)


def is_optional(type_: Any) -> TypeGuard[ArgsTypeProcotol]:
    return is_origin_of(
        type_,
        "Optional",
        "Union",
        "UnionType",
    )


def is_optional_union(type_: Any) -> bool:
    return is_optional(type_) and NoneType in typing_get_args(type_)


def is_union(type_: Any) -> TypeGuard[ArgsTypeProcotol]:
    return is_origin_of(type_, "Union")


def is_origin_of_cls(
    type_: Any, class_obj: Union[Tuple[Type[Any], ...], Type[Any]]
) -> bool:
    """return True if the given type has an __origin__ that shares a base
    with the given class"""

    origin = typing_get_origin(type_)
    if origin is None:
        return False

    return isinstance(origin, type) and issubclass(origin, class_obj)


def is_origin_of(
    type_: Any, *names: str, module: Optional[str] = None
) -> bool:
    """return True if the given type has an __origin__ with the given name
    and optional module."""

    origin = typing_get_origin(type_)
    if origin is None:
        return False

    return _get_type_name(origin) in names and (
        module is None or origin.__module__.startswith(module)
    )


def _get_type_name(type_: Type[Any]) -> str:
    if compat.py310:
        return type_.__name__
    else:
        typ_name = getattr(type_, "__name__", None)
        if typ_name is None:
            typ_name = getattr(type_, "_name", None)

        return typ_name  # type: ignore


class DescriptorProto(Protocol):
    def __get__(self, instance: object, owner: Any) -> Any:
        ...

    def __set__(self, instance: Any, value: Any) -> None:
        ...

    def __delete__(self, instance: Any) -> None:
        ...


_DESC = TypeVar("_DESC", bound=DescriptorProto)


class DescriptorReference(Generic[_DESC]):
    """a descriptor that refers to a descriptor.

    used for cases where we need to have an instance variable referring to an
    object that is itself a descriptor, which typically confuses typing tools
    as they don't know when they should use ``__get__`` or not when referring
    to the descriptor assignment as an instance variable. See
    sqlalchemy.orm.interfaces.PropComparator.prop

    """

    if TYPE_CHECKING:

        def __get__(self, instance: object, owner: Any) -> _DESC:
            ...

        def __set__(self, instance: Any, value: _DESC) -> None:
            ...

        def __delete__(self, instance: Any) -> None:
            ...


_DESC_co = TypeVar("_DESC_co", bound=DescriptorProto, covariant=True)


class RODescriptorReference(Generic[_DESC_co]):
    """a descriptor that refers to a descriptor.

    same as :class:`.DescriptorReference` but is read-only, so that subclasses
    can define a subtype as the generically contained element

    """

    if TYPE_CHECKING:

        def __get__(self, instance: object, owner: Any) -> _DESC_co:
            ...

        def __set__(self, instance: Any, value: Any) -> NoReturn:
            ...

        def __delete__(self, instance: Any) -> NoReturn:
            ...


_FN = TypeVar("_FN", bound=Optional[Callable[..., Any]])


class CallableReference(Generic[_FN]):
    """a descriptor that refers to a callable.

    works around mypy's limitation of not allowing callables assigned
    as instance variables


    """

    if TYPE_CHECKING:

        def __get__(self, instance: object, owner: Any) -> _FN:
            ...

        def __set__(self, instance: Any, value: _FN) -> None:
            ...

        def __delete__(self, instance: Any) -> None:
            ...


# $def ro_descriptor_reference(fn: Callable[])
