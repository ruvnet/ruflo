from __future__ import annotations

from typing import Any, cast
from typing_extensions import Required, Annotated, get_args, get_origin

from .._types import InheritsGeneric
from .._compat import is_union as _is_union


def is_annotated_type(typ: type) -> bool:
    return get_origin(typ) == Annotated


def is_list_type(typ: type) -> bool:
    return (get_origin(typ) or typ) == list


def is_union_type(typ: type) -> bool:
    return _is_union(get_origin(typ))


def is_required_type(typ: type) -> bool:
    return get_origin(typ) == Required


# Extracts T from Annotated[T, ...] or from Required[Annotated[T, ...]]
def strip_annotated_type(typ: type) -> type:
    if is_required_type(typ) or is_annotated_type(typ):
        return strip_annotated_type(cast(type, get_args(typ)[0]))

    return typ


def extract_type_arg(typ: type, index: int) -> type:
    args = get_args(typ)
    try:
        return cast(type, args[index])
    except IndexError as err:
        raise RuntimeError(f"Expected type {typ} to have a type argument at index {index} but it did not") from err


def extract_type_var_from_base(typ: type, *, generic_bases: tuple[type, ...], index: int) -> type:
    """Given a type like `Foo[T]`, returns the generic type variable `T`.

    This also handles the case where a concrete subclass is given, e.g.
    ```py
    class MyResponse(Foo[bytes]):
        ...

    extract_type_var(MyResponse, bases=(Foo,), index=0) -> bytes
    ```
    """
    cls = cast(object, get_origin(typ) or typ)
    if cls in generic_bases:
        # we're given the class directly
        return extract_type_arg(typ, index)

    # if a subclass is given
    # ---
    # this is needed as __orig_bases__ is not present in the typeshed stubs
    # because it is intended to be for internal use only, however there does
    # not seem to be a way to resolve generic TypeVars for inherited subclasses
    # without using it.
    if isinstance(cls, InheritsGeneric):
        target_base_class: Any | None = None
        for base in cls.__orig_bases__:
            if base.__origin__ in generic_bases:
                target_base_class = base
                break

        if target_base_class is None:
            raise RuntimeError(
                "Could not find the generic base class;\n"
                "This should never happen;\n"
                f"Does {cls} inherit from one of {generic_bases} ?"
            )

        return extract_type_arg(target_base_class, index)

    raise RuntimeError(f"Could not resolve inner type variable at index {index} for {typ}")
