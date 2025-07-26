"""
Backport Python3.8+ typing utils &amp; issubtype &amp; more

![Python 3.6](https://github.com/bojiang/typing_utils/workflows/Python%203.6/badge.svg)
![Python 3.7](https://github.com/bojiang/typing_utils/workflows/Python%203.7/badge.svg)
![Python 3.8](https://github.com/bojiang/typing_utils/workflows/Python%203.8/badge.svg)

## Install

``` bash
    pip install typing_utils
```
"""

import collections.abc
import io
import itertools
import types
import typing

if hasattr(typing, "ForwardRef"):  # python3.8
    ForwardRef = getattr(typing, "ForwardRef")
elif hasattr(typing, "_ForwardRef"):  # python3.6
    ForwardRef = getattr(typing, "_ForwardRef")
else:
    raise NotImplementedError()

if hasattr(typing, "Literal"):
    Literal = getattr(typing, "Literal")
else:
    Literal = None

if hasattr(typing, "_TypedDictMeta"):
    _TypedDictMeta = getattr(typing, "_TypedDictMeta")
else:
    _TypedDictMeta = None

if hasattr(types, "UnionType"):
    UnionType = getattr(types, "UnionType")
else:
    UnionType = None

unknown = None

BUILTINS_MAPPING = {
    typing.List: list,
    typing.Set: set,
    typing.Dict: dict,
    typing.Tuple: tuple,
    typing.ByteString: bytes,  # https://docs.python.org/3/library/typing.html#typing.ByteString
    typing.Callable: collections.abc.Callable,
    typing.Sequence: collections.abc.Sequence,
    type(None): None,
}

STATIC_SUBTYPE_MAPPING: typing.Dict[type, typing.Type] = {
    io.TextIOWrapper: typing.TextIO,
    io.TextIOBase: typing.TextIO,
    io.StringIO: typing.TextIO,
    io.BufferedReader: typing.BinaryIO,
    io.BufferedWriter: typing.BinaryIO,
    io.BytesIO: typing.BinaryIO,
}

if UnionType:

    def is_union(element: object) -> bool:
        return element is typing.Union or element is UnionType

else:

    def is_union(element: object) -> bool:
        return element is typing.Union


def optional_all(elements) -> typing.Optional[bool]:
    if all(elements):
        return True
    if all(e is False for e in elements):
        return False
    return unknown


def optional_any(elements) -> typing.Optional[bool]:
    if any(elements):
        return True
    if any(e is None for e in elements):
        return unknown
    return False


def _hashable(value):
    """Determine whether `value` can be hashed."""
    try:
        hash(value)
    except TypeError:
        return False
    return True


get_type_hints = typing.get_type_hints

GenericClass = type(typing.List)
UnionClass = type(typing.Union)

Type = typing.Union[None, type, "typing.TypeVar"]
OriginType = typing.Union[None, type]
TypeArgs = typing.Union[type, typing.AbstractSet[type], typing.Sequence[type]]


def _normalize_aliases(type_: Type) -> Type:
    if isinstance(type_, typing.TypeVar):
        return type_

    assert _hashable(type_), "_normalize_aliases should only be called on element types"

    if type_ in BUILTINS_MAPPING:
        return BUILTINS_MAPPING[type_]  # type: ignore
    return type_


def get_origin(type_):
    """Get the unsubscripted version of a type.
    This supports generic types, Callable, Tuple, Union, Literal, Final and ClassVar.
    Return None for unsupported types.

    Examples:

    ```python
        from typing_utils import get_origin

        get_origin(Literal[42]) is Literal
        get_origin(int) is None
        get_origin(ClassVar[int]) is ClassVar
        get_origin(Generic) is Generic
        get_origin(Generic[T]) is Generic
        get_origin(Union[T, int]) is Union
        get_origin(List[Tuple[T, T]][int]) == list
    ```
    """
    if hasattr(typing, "get_origin"):  # python 3.8+
        _getter = getattr(typing, "get_origin")
        ori = _getter(type_)
    elif hasattr(typing.List, "_special"):  # python 3.7
        if isinstance(type_, GenericClass) and not type_._special:
            ori = type_.__origin__
        elif hasattr(type_, "_special") and type_._special:
            ori = type_
        elif type_ is typing.Generic:
            ori = typing.Generic
        else:
            ori = None
    else:  # python 3.6
        if isinstance(type_, GenericClass):
            ori = type_.__origin__
            if ori is None:
                ori = type_
        elif isinstance(type_, UnionClass):
            ori = type_.__origin__
        elif type_ is typing.Generic:
            ori = typing.Generic
        else:
            ori = None
    if ori is None and _TypedDictMeta and isinstance(type_, _TypedDictMeta):
        ori = dict
    return _normalize_aliases(ori)


def get_args(type_) -> typing.Tuple:
    """Get type arguments with all substitutions performed.
    For unions, basic simplifications used by Union constructor are performed.

    Examples:

    ```python
        from typing_utils import get_args

        get_args(Dict[str, int]) == (str, int)
        get_args(int) == ()
        get_args(Union[int, Union[T, int], str][int]) == (int, str)
        get_args(Union[int, Tuple[T, int]][str]) == (int, Tuple[str, int])
        get_args(Callable[[], T][int]) == ([], int)
    ```
    """
    if hasattr(typing, "get_args"):  # python 3.8+
        _getter = getattr(typing, "get_args")
        res = _getter(type_)
    elif hasattr(typing.List, "_special"):  # python 3.7
        if (
            isinstance(type_, GenericClass) and not type_._special  # type: ignore
        ):  # backport for python 3.8
            res = type_.__args__  # type: ignore
            if get_origin(type_) is collections.abc.Callable and res[0] is not Ellipsis:
                res = (list(res[:-1]), res[-1])
        else:
            res = ()
    else:  # python 3.6
        if isinstance(type_, (GenericClass, UnionClass)):  # backport for python 3.8
            res = type_.__args__  # type: ignore
            if get_origin(type_) is collections.abc.Callable and res[0] is not Ellipsis:
                res = (list(res[:-1]), res[-1])
        else:
            res = ()
    if _TypedDictMeta and isinstance(type_, _TypedDictMeta):
        return str, typing.Any
    return () if res is None else res


def eval_forward_ref(ref, forward_refs=None):
    """
    eval forward_refs in all cPython versions
    """
    localns = forward_refs or {}

    if hasattr(typing, "_eval_type"):  # python3.8 & python 3.9
        _eval_type = getattr(typing, "_eval_type")
        return _eval_type(ref, globals(), localns)

    if hasattr(ref, "_eval_type"):  # python3.6
        _eval_type = getattr(ref, "_eval_type")
        return _eval_type(globals(), localns)

    raise NotImplementedError()


class NormalizedType(typing.NamedTuple):
    """
    Normalized type, made it possible to compare, hash between types.
    """

    origin: Type
    args: typing.Union[tuple, frozenset] = tuple()

    def __eq__(self, other):
        if isinstance(other, NormalizedType):
            if self.origin != other.origin:
                return False
            if isinstance(self.args, frozenset) and isinstance(other.args, frozenset):
                return self.args <= other.args and other.args <= self.args
            return self.origin == other.origin and self.args == other.args
        if not self.args:
            return self.origin == other
        return False

    def __hash__(self) -> int:
        if not self.args:
            return hash(self.origin)
        return hash((self.origin, self.args))

    def __repr__(self):
        if not self.args:
            return f"{self.origin}"
        return f"{self.origin}[{self.args}])"


def _normalize_args(tps: TypeArgs):
    if isinstance(tps, str):
        return tps
    if isinstance(tps, collections.abc.Sequence):
        return tuple(_normalize_args(type_) for type_ in tps)
    if isinstance(tps, collections.abc.Set):
        return frozenset(_normalize_args(type_) for type_ in tps)
    return normalize(tps)


def normalize(type_: Type) -> NormalizedType:
    """
    convert types to NormalizedType instances.
    """
    args = get_args(type_)
    origin = get_origin(type_)
    if not origin:
        return NormalizedType(_normalize_aliases(type_))
    origin = _normalize_aliases(origin)

    if is_union(origin):  # sort args when the origin is Union
        args = _normalize_args(frozenset(args))
    else:
        args = _normalize_args(args)
    return NormalizedType(origin, args)


def _is_origin_subtype(left: OriginType, right: OriginType) -> bool:
    if left is right:
        return True

    if (
        left is not None
        and left in STATIC_SUBTYPE_MAPPING
        and right == STATIC_SUBTYPE_MAPPING[left]
    ):
        return True

    if hasattr(left, "mro"):
        for parent in left.mro():  # type: ignore
            if parent == right:
                return True

    if isinstance(left, type) and isinstance(right, type):
        return issubclass(left, right)

    return left == right


NormalizedTypeArgs = typing.Union[
    typing.Tuple[typing.Any, ...],
    typing.FrozenSet[NormalizedType],
    NormalizedType,
]


def _is_origin_subtype_args(
    left: "NormalizedTypeArgs",
    right: "NormalizedTypeArgs",
    forward_refs: typing.Optional[typing.Mapping[str, type]],
) -> typing.Optional[bool]:
    if isinstance(left, frozenset):
        if not isinstance(right, frozenset):
            return False

        excluded = left - right
        if not excluded:
            # Union[str, int] <> Union[int, str]
            return True

        # Union[list, int] <> Union[typing.Sequence, int]
        return all(
            any(_is_normal_subtype(e, r, forward_refs) for r in right) for e in excluded
        )

    if isinstance(left, collections.abc.Sequence) and not isinstance(
        left, NormalizedType
    ):
        if not isinstance(right, collections.abc.Sequence) or isinstance(
            right, NormalizedType
        ):
            return False

        if (
            left
            and left[-1].origin is not Ellipsis
            and right
            and right[-1].origin is Ellipsis
        ):
            # Tuple[type, type] <> Tuple[type, ...]
            return all(_is_origin_subtype_args(l, right[0], forward_refs) for l in left)

        if len(left) != len(right):
            return False

        return all(
            l is not None
            and r is not None
            and _is_origin_subtype_args(l, r, forward_refs)
            for l, r in itertools.zip_longest(left, right)
        )

    assert isinstance(left, NormalizedType)
    assert isinstance(right, NormalizedType)

    return _is_normal_subtype(left, right, forward_refs)


def _is_normal_subtype(
    left: NormalizedType,
    right: NormalizedType,
    forward_refs: typing.Optional[typing.Mapping[str, type]],
) -> typing.Optional[bool]:
    if isinstance(left.origin, ForwardRef):
        left = normalize(eval_forward_ref(left.origin, forward_refs=forward_refs))

    if isinstance(right.origin, ForwardRef):
        right = normalize(eval_forward_ref(right.origin, forward_refs=forward_refs))

    # Any
    if right.origin is typing.Any:
        return True

    # Union
    if is_union(right.origin) and is_union(left.origin):
        return _is_origin_subtype_args(left.args, right.args, forward_refs)
    if is_union(right.origin):
        return optional_any(
            _is_normal_subtype(left, a, forward_refs) for a in right.args
        )
    if is_union(left.origin):
        return optional_all(
            _is_normal_subtype(a, right, forward_refs) for a in left.args
        )

    # Literal
    if right.origin is Literal:
        if left.origin is not Literal:
            return False
        return set(left.args).issubset(set(right.args))

    # TypeVar
    if isinstance(left.origin, typing.TypeVar) and isinstance(
        right.origin, typing.TypeVar
    ):
        if left.origin is right.origin:
            return True

        left_bound = getattr(left.origin, "__bound__", None)
        right_bound = getattr(right.origin, "__bound__", None)
        if right_bound is None or left_bound is None:
            return unknown
        return _is_normal_subtype(
            normalize(left_bound), normalize(right_bound), forward_refs
        )
    if isinstance(right.origin, typing.TypeVar):
        return unknown
    if isinstance(left.origin, typing.TypeVar):
        left_bound = getattr(left.origin, "__bound__", None)
        if left_bound is None:
            return unknown
        return _is_normal_subtype(normalize(left_bound), right, forward_refs)

    if not left.args and not right.args:
        return _is_origin_subtype(left.origin, right.origin)

    if not right.args:
        return _is_origin_subtype(left.origin, right.origin)

    if _is_origin_subtype(left.origin, right.origin):
        return _is_origin_subtype_args(left.args, right.args, forward_refs)

    return False


def issubtype(
    left: Type,
    right: Type,
    forward_refs: typing.Optional[dict] = None,
) -> typing.Optional[bool]:
    """Check that the left argument is a subtype of the right.
    For unions, check if the type arguments of the left is a subset of the right.
    Also works for nested types including ForwardRefs.

    Examples:

    ```python
        from typing_utils import issubtype

        issubtype(typing.List, typing.Any) == True
        issubtype(list, list) == True
        issubtype(list, typing.List) == True
        issubtype(list, typing.Sequence) == True
        issubtype(typing.List[int], list) == True
        issubtype(typing.List[typing.List], list) == True
        issubtype(list, typing.List[int]) == False
        issubtype(list, typing.Union[typing.Tuple, typing.Set]) == False
        issubtype(typing.List[typing.List], typing.List[typing.Sequence]) == True
        JSON = typing.Union[
            int, float, bool, str, None, typing.Sequence["JSON"],
            typing.Mapping[str, "JSON"]
        ]
        issubtype(str, JSON, forward_refs={'JSON': JSON}) == True
        issubtype(typing.Dict[str, str], JSON, forward_refs={'JSON': JSON}) == True
        issubtype(typing.Dict[str, bytes], JSON, forward_refs={'JSON': JSON}) == False
    ```
    """
    return _is_normal_subtype(normalize(left), normalize(right), forward_refs)


__all__ = [
    "issubtype",
    "get_origin",
    "get_args",
    "get_type_hints",
]
