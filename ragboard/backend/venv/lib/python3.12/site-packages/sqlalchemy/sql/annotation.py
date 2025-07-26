# sql/annotation.py
# Copyright (C) 2005-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php

"""The :class:`.Annotated` class and related routines; creates hash-equivalent
copies of SQL constructs which contain context-specific markers and
associations.

Note that the :class:`.Annotated` concept as implemented in this module is not
related in any way to the pep-593 concept of "Annotated".


"""

from __future__ import annotations

import typing
from typing import Any
from typing import Callable
from typing import cast
from typing import Dict
from typing import FrozenSet
from typing import Mapping
from typing import Optional
from typing import overload
from typing import Sequence
from typing import Tuple
from typing import Type
from typing import TYPE_CHECKING
from typing import TypeVar

from . import operators
from .cache_key import HasCacheKey
from .visitors import anon_map
from .visitors import ExternallyTraversible
from .visitors import InternalTraversal
from .. import util
from ..util.typing import Literal
from ..util.typing import Self

if TYPE_CHECKING:
    from .base import _EntityNamespace
    from .visitors import _TraverseInternalsType

_AnnotationDict = Mapping[str, Any]

EMPTY_ANNOTATIONS: util.immutabledict[str, Any] = util.EMPTY_DICT


class SupportsAnnotations(ExternallyTraversible):
    __slots__ = ()

    _annotations: util.immutabledict[str, Any] = EMPTY_ANNOTATIONS

    proxy_set: util.generic_fn_descriptor[FrozenSet[Any]]

    _is_immutable: bool

    def _annotate(self, values: _AnnotationDict) -> Self:
        raise NotImplementedError()

    @overload
    def _deannotate(
        self,
        values: Literal[None] = ...,
        clone: bool = ...,
    ) -> Self:
        ...

    @overload
    def _deannotate(
        self,
        values: Sequence[str] = ...,
        clone: bool = ...,
    ) -> SupportsAnnotations:
        ...

    def _deannotate(
        self,
        values: Optional[Sequence[str]] = None,
        clone: bool = False,
    ) -> SupportsAnnotations:
        raise NotImplementedError()

    @util.memoized_property
    def _annotations_cache_key(self) -> Tuple[Any, ...]:
        anon_map_ = anon_map()

        return self._gen_annotations_cache_key(anon_map_)

    def _gen_annotations_cache_key(
        self, anon_map: anon_map
    ) -> Tuple[Any, ...]:
        return (
            "_annotations",
            tuple(
                (
                    key,
                    value._gen_cache_key(anon_map, [])
                    if isinstance(value, HasCacheKey)
                    else value,
                )
                for key, value in [
                    (key, self._annotations[key])
                    for key in sorted(self._annotations)
                ]
            ),
        )


class SupportsWrappingAnnotations(SupportsAnnotations):
    __slots__ = ()

    _constructor: Callable[..., SupportsWrappingAnnotations]

    if TYPE_CHECKING:

        @util.ro_non_memoized_property
        def entity_namespace(self) -> _EntityNamespace:
            ...

    def _annotate(self, values: _AnnotationDict) -> Self:
        """return a copy of this ClauseElement with annotations
        updated by the given dictionary.

        """
        return Annotated._as_annotated_instance(self, values)  # type: ignore

    def _with_annotations(self, values: _AnnotationDict) -> Self:
        """return a copy of this ClauseElement with annotations
        replaced by the given dictionary.

        """
        return Annotated._as_annotated_instance(self, values)  # type: ignore

    @overload
    def _deannotate(
        self,
        values: Literal[None] = ...,
        clone: bool = ...,
    ) -> Self:
        ...

    @overload
    def _deannotate(
        self,
        values: Sequence[str] = ...,
        clone: bool = ...,
    ) -> SupportsAnnotations:
        ...

    def _deannotate(
        self,
        values: Optional[Sequence[str]] = None,
        clone: bool = False,
    ) -> SupportsAnnotations:
        """return a copy of this :class:`_expression.ClauseElement`
        with annotations
        removed.

        :param values: optional tuple of individual values
         to remove.

        """
        if clone:
            s = self._clone()
            return s
        else:
            return self


class SupportsCloneAnnotations(SupportsWrappingAnnotations):
    # SupportsCloneAnnotations extends from SupportsWrappingAnnotations
    # to support the structure of having the base ClauseElement
    # be a subclass of SupportsWrappingAnnotations.  Any ClauseElement
    # subclass that wants to extend from SupportsCloneAnnotations
    # will inherently also be subclassing SupportsWrappingAnnotations, so
    # make that specific here.

    if not typing.TYPE_CHECKING:
        __slots__ = ()

    _clone_annotations_traverse_internals: _TraverseInternalsType = [
        ("_annotations", InternalTraversal.dp_annotations_key)
    ]

    def _annotate(self, values: _AnnotationDict) -> Self:
        """return a copy of this ClauseElement with annotations
        updated by the given dictionary.

        """
        new = self._clone()
        new._annotations = new._annotations.union(values)
        new.__dict__.pop("_annotations_cache_key", None)
        new.__dict__.pop("_generate_cache_key", None)
        return new

    def _with_annotations(self, values: _AnnotationDict) -> Self:
        """return a copy of this ClauseElement with annotations
        replaced by the given dictionary.

        """
        new = self._clone()
        new._annotations = util.immutabledict(values)
        new.__dict__.pop("_annotations_cache_key", None)
        new.__dict__.pop("_generate_cache_key", None)
        return new

    @overload
    def _deannotate(
        self,
        values: Literal[None] = ...,
        clone: bool = ...,
    ) -> Self:
        ...

    @overload
    def _deannotate(
        self,
        values: Sequence[str] = ...,
        clone: bool = ...,
    ) -> SupportsAnnotations:
        ...

    def _deannotate(
        self,
        values: Optional[Sequence[str]] = None,
        clone: bool = False,
    ) -> SupportsAnnotations:
        """return a copy of this :class:`_expression.ClauseElement`
        with annotations
        removed.

        :param values: optional tuple of individual values
         to remove.

        """
        if clone or self._annotations:
            # clone is used when we are also copying
            # the expression for a deep deannotation
            new = self._clone()
            new._annotations = util.immutabledict()
            new.__dict__.pop("_annotations_cache_key", None)
            return new
        else:
            return self


class Annotated(SupportsAnnotations):
    """clones a SupportsAnnotations and applies an 'annotations' dictionary.

    Unlike regular clones, this clone also mimics __hash__() and
    __eq__() of the original element so that it takes its place
    in hashed collections.

    A reference to the original element is maintained, for the important
    reason of keeping its hash value current.  When GC'ed, the
    hash value may be reused, causing conflicts.

    .. note::  The rationale for Annotated producing a brand new class,
       rather than placing the functionality directly within ClauseElement,
       is **performance**.  The __hash__() method is absent on plain
       ClauseElement which leads to significantly reduced function call
       overhead, as the use of sets and dictionaries against ClauseElement
       objects is prevalent, but most are not "annotated".

    """

    _is_column_operators = False

    @classmethod
    def _as_annotated_instance(
        cls, element: SupportsWrappingAnnotations, values: _AnnotationDict
    ) -> Annotated:
        try:
            cls = annotated_classes[element.__class__]
        except KeyError:
            cls = _new_annotation_type(element.__class__, cls)
        return cls(element, values)

    _annotations: util.immutabledict[str, Any]
    __element: SupportsWrappingAnnotations
    _hash: int

    def __new__(cls: Type[Self], *args: Any) -> Self:
        return object.__new__(cls)

    def __init__(
        self, element: SupportsWrappingAnnotations, values: _AnnotationDict
    ):
        self.__dict__ = element.__dict__.copy()
        self.__dict__.pop("_annotations_cache_key", None)
        self.__dict__.pop("_generate_cache_key", None)
        self.__element = element
        self._annotations = util.immutabledict(values)
        self._hash = hash(element)

    def _annotate(self, values: _AnnotationDict) -> Self:
        _values = self._annotations.union(values)
        new = self._with_annotations(_values)
        return new

    def _with_annotations(self, values: _AnnotationDict) -> Self:
        clone = self.__class__.__new__(self.__class__)
        clone.__dict__ = self.__dict__.copy()
        clone.__dict__.pop("_annotations_cache_key", None)
        clone.__dict__.pop("_generate_cache_key", None)
        clone._annotations = util.immutabledict(values)
        return clone

    @overload
    def _deannotate(
        self,
        values: Literal[None] = ...,
        clone: bool = ...,
    ) -> Self:
        ...

    @overload
    def _deannotate(
        self,
        values: Sequence[str] = ...,
        clone: bool = ...,
    ) -> Annotated:
        ...

    def _deannotate(
        self,
        values: Optional[Sequence[str]] = None,
        clone: bool = True,
    ) -> SupportsAnnotations:
        if values is None:
            return self.__element
        else:
            return self._with_annotations(
                util.immutabledict(
                    {
                        key: value
                        for key, value in self._annotations.items()
                        if key not in values
                    }
                )
            )

    if not typing.TYPE_CHECKING:
        # manually proxy some methods that need extra attention
        def _compiler_dispatch(self, visitor: Any, **kw: Any) -> Any:
            return self.__element.__class__._compiler_dispatch(
                self, visitor, **kw
            )

        @property
        def _constructor(self):
            return self.__element._constructor

    def _clone(self, **kw: Any) -> Self:
        clone = self.__element._clone(**kw)
        if clone is self.__element:
            # detect immutable, don't change anything
            return self
        else:
            # update the clone with any changes that have occurred
            # to this object's __dict__.
            clone.__dict__.update(self.__dict__)
            return self.__class__(clone, self._annotations)

    def __reduce__(self) -> Tuple[Type[Annotated], Tuple[Any, ...]]:
        return self.__class__, (self.__element, self._annotations)

    def __hash__(self) -> int:
        return self._hash

    def __eq__(self, other: Any) -> bool:
        if self._is_column_operators:
            return self.__element.__class__.__eq__(self, other)
        else:
            return hash(other) == hash(self)

    @util.ro_non_memoized_property
    def entity_namespace(self) -> _EntityNamespace:
        if "entity_namespace" in self._annotations:
            return cast(
                SupportsWrappingAnnotations,
                self._annotations["entity_namespace"],
            ).entity_namespace
        else:
            return self.__element.entity_namespace


# hard-generate Annotated subclasses.  this technique
# is used instead of on-the-fly types (i.e. type.__new__())
# so that the resulting objects are pickleable; additionally, other
# decisions can be made up front about the type of object being annotated
# just once per class rather than per-instance.
annotated_classes: Dict[
    Type[SupportsWrappingAnnotations], Type[Annotated]
] = {}

_SA = TypeVar("_SA", bound="SupportsAnnotations")


def _safe_annotate(to_annotate: _SA, annotations: _AnnotationDict) -> _SA:
    try:
        _annotate = to_annotate._annotate
    except AttributeError:
        # skip objects that don't actually have an `_annotate`
        # attribute, namely QueryableAttribute inside of a join
        # condition
        return to_annotate
    else:
        return _annotate(annotations)


def _deep_annotate(
    element: _SA,
    annotations: _AnnotationDict,
    exclude: Optional[Sequence[SupportsAnnotations]] = None,
    *,
    detect_subquery_cols: bool = False,
    ind_cols_on_fromclause: bool = False,
    annotate_callable: Optional[
        Callable[[SupportsAnnotations, _AnnotationDict], SupportsAnnotations]
    ] = None,
) -> _SA:
    """Deep copy the given ClauseElement, annotating each element
    with the given annotations dictionary.

    Elements within the exclude collection will be cloned but not annotated.

    """

    # annotated objects hack the __hash__() method so if we want to
    # uniquely process them we have to use id()

    cloned_ids: Dict[int, SupportsAnnotations] = {}

    def clone(elem: SupportsAnnotations, **kw: Any) -> SupportsAnnotations:
        # ind_cols_on_fromclause means make sure an AnnotatedFromClause
        # has its own .c collection independent of that which its proxying.
        # this is used specifically by orm.LoaderCriteriaOption to break
        # a reference cycle that it's otherwise prone to building,
        # see test_relationship_criteria->
        # test_loader_criteria_subquery_w_same_entity.  logic here was
        # changed for #8796 and made explicit; previously it occurred
        # by accident

        kw["detect_subquery_cols"] = detect_subquery_cols
        id_ = id(elem)

        if id_ in cloned_ids:
            return cloned_ids[id_]

        if (
            exclude
            and hasattr(elem, "proxy_set")
            and elem.proxy_set.intersection(exclude)
        ):
            newelem = elem._clone(clone=clone, **kw)
        elif annotations != elem._annotations:
            if detect_subquery_cols and elem._is_immutable:
                to_annotate = elem._clone(clone=clone, **kw)
            else:
                to_annotate = elem
            if annotate_callable:
                newelem = annotate_callable(to_annotate, annotations)
            else:
                newelem = _safe_annotate(to_annotate, annotations)
        else:
            newelem = elem

        newelem._copy_internals(
            clone=clone, ind_cols_on_fromclause=ind_cols_on_fromclause
        )

        cloned_ids[id_] = newelem
        return newelem

    if element is not None:
        element = cast(_SA, clone(element))
    clone = None  # type: ignore  # remove gc cycles
    return element


@overload
def _deep_deannotate(
    element: Literal[None], values: Optional[Sequence[str]] = None
) -> Literal[None]:
    ...


@overload
def _deep_deannotate(
    element: _SA, values: Optional[Sequence[str]] = None
) -> _SA:
    ...


def _deep_deannotate(
    element: Optional[_SA], values: Optional[Sequence[str]] = None
) -> Optional[_SA]:
    """Deep copy the given element, removing annotations."""

    cloned: Dict[Any, SupportsAnnotations] = {}

    def clone(elem: SupportsAnnotations, **kw: Any) -> SupportsAnnotations:
        key: Any
        if values:
            key = id(elem)
        else:
            key = elem

        if key not in cloned:
            newelem = elem._deannotate(values=values, clone=True)
            newelem._copy_internals(clone=clone)
            cloned[key] = newelem
            return newelem
        else:
            return cloned[key]

    if element is not None:
        element = cast(_SA, clone(element))
    clone = None  # type: ignore  # remove gc cycles
    return element


def _shallow_annotate(element: _SA, annotations: _AnnotationDict) -> _SA:
    """Annotate the given ClauseElement and copy its internals so that
    internal objects refer to the new annotated object.

    Basically used to apply a "don't traverse" annotation to a
    selectable, without digging throughout the whole
    structure wasting time.
    """
    element = element._annotate(annotations)
    element._copy_internals()
    return element


def _new_annotation_type(
    cls: Type[SupportsWrappingAnnotations], base_cls: Type[Annotated]
) -> Type[Annotated]:
    """Generates a new class that subclasses Annotated and proxies a given
    element type.

    """
    if issubclass(cls, Annotated):
        return cls
    elif cls in annotated_classes:
        return annotated_classes[cls]

    for super_ in cls.__mro__:
        # check if an Annotated subclass more specific than
        # the given base_cls is already registered, such
        # as AnnotatedColumnElement.
        if super_ in annotated_classes:
            base_cls = annotated_classes[super_]
            break

    annotated_classes[cls] = anno_cls = cast(
        Type[Annotated],
        type("Annotated%s" % cls.__name__, (base_cls, cls), {}),
    )
    globals()["Annotated%s" % cls.__name__] = anno_cls

    if "_traverse_internals" in cls.__dict__:
        anno_cls._traverse_internals = list(cls._traverse_internals) + [
            ("_annotations", InternalTraversal.dp_annotations_key)
        ]
    elif cls.__dict__.get("inherit_cache", False):
        anno_cls._traverse_internals = list(cls._traverse_internals) + [
            ("_annotations", InternalTraversal.dp_annotations_key)
        ]

    # some classes include this even if they have traverse_internals
    # e.g. BindParameter, add it if present.
    if cls.__dict__.get("inherit_cache", False):
        anno_cls.inherit_cache = True  # type: ignore
    elif "inherit_cache" in cls.__dict__:
        anno_cls.inherit_cache = cls.__dict__["inherit_cache"]  # type: ignore

    anno_cls._is_column_operators = issubclass(cls, operators.ColumnOperators)

    return anno_cls


def _prepare_annotations(
    target_hierarchy: Type[SupportsWrappingAnnotations],
    base_cls: Type[Annotated],
) -> None:
    for cls in util.walk_subclasses(target_hierarchy):
        _new_annotation_type(cls, base_cls)
