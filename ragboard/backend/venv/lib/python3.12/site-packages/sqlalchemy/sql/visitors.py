# sql/visitors.py
# Copyright (C) 2005-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php

"""Visitor/traversal interface and library functions.


"""

from __future__ import annotations

from collections import deque
from enum import Enum
import itertools
import operator
import typing
from typing import Any
from typing import Callable
from typing import cast
from typing import ClassVar
from typing import Dict
from typing import Iterable
from typing import Iterator
from typing import List
from typing import Mapping
from typing import Optional
from typing import overload
from typing import Tuple
from typing import Type
from typing import TYPE_CHECKING
from typing import TypeVar
from typing import Union

from .. import exc
from .. import util
from ..util import langhelpers
from ..util._has_cy import HAS_CYEXTENSION
from ..util.typing import Literal
from ..util.typing import Protocol
from ..util.typing import Self

if TYPE_CHECKING:
    from .annotation import _AnnotationDict
    from .elements import ColumnElement

if typing.TYPE_CHECKING or not HAS_CYEXTENSION:
    from ._py_util import prefix_anon_map as prefix_anon_map
    from ._py_util import cache_anon_map as anon_map
else:
    from sqlalchemy.cyextension.util import (  # noqa: F401,E501
        prefix_anon_map as prefix_anon_map,
    )
    from sqlalchemy.cyextension.util import (  # noqa: F401,E501
        cache_anon_map as anon_map,
    )


__all__ = [
    "iterate",
    "traverse_using",
    "traverse",
    "cloned_traverse",
    "replacement_traverse",
    "Visitable",
    "ExternalTraversal",
    "InternalTraversal",
    "anon_map",
]


class _CompilerDispatchType(Protocol):
    def __call__(_self, self: Visitable, visitor: Any, **kw: Any) -> Any:
        ...


class Visitable:
    """Base class for visitable objects.

    :class:`.Visitable` is used to implement the SQL compiler dispatch
    functions.    Other forms of traversal such as for cache key generation
    are implemented separately using the :class:`.HasTraverseInternals`
    interface.

    .. versionchanged:: 2.0  The :class:`.Visitable` class was named
       :class:`.Traversible` in the 1.4 series; the name is changed back
       to :class:`.Visitable` in 2.0 which is what it was prior to 1.4.

       Both names remain importable in both 1.4 and 2.0 versions.

    """

    __slots__ = ()

    __visit_name__: str

    _original_compiler_dispatch: _CompilerDispatchType

    if typing.TYPE_CHECKING:

        def _compiler_dispatch(self, visitor: Any, **kw: Any) -> str:
            ...

    def __init_subclass__(cls) -> None:
        if "__visit_name__" in cls.__dict__:
            cls._generate_compiler_dispatch()
        super().__init_subclass__()

    @classmethod
    def _generate_compiler_dispatch(cls) -> None:
        visit_name = cls.__visit_name__

        if "_compiler_dispatch" in cls.__dict__:
            # class has a fixed _compiler_dispatch() method.
            # copy it to "original" so that we can get it back if
            # sqlalchemy.ext.compiles overrides it.
            cls._original_compiler_dispatch = cls._compiler_dispatch
            return

        if not isinstance(visit_name, str):
            raise exc.InvalidRequestError(
                f"__visit_name__ on class {cls.__name__} must be a string "
                "at the class level"
            )

        name = "visit_%s" % visit_name
        getter = operator.attrgetter(name)

        def _compiler_dispatch(
            self: Visitable, visitor: Any, **kw: Any
        ) -> str:
            """Look for an attribute named "visit_<visit_name>" on the
            visitor, and call it with the same kw params.

            """
            try:
                meth = getter(visitor)
            except AttributeError as err:
                return visitor.visit_unsupported_compilation(self, err, **kw)  # type: ignore  # noqa: E501
            else:
                return meth(self, **kw)  # type: ignore  # noqa: E501

        cls._compiler_dispatch = (  # type: ignore
            cls._original_compiler_dispatch
        ) = _compiler_dispatch

    def __class_getitem__(cls, key: Any) -> Any:
        # allow generic classes in py3.9+
        return cls


class InternalTraversal(Enum):
    r"""Defines visitor symbols used for internal traversal.

    The :class:`.InternalTraversal` class is used in two ways.  One is that
    it can serve as the superclass for an object that implements the
    various visit methods of the class.   The other is that the symbols
    themselves of :class:`.InternalTraversal` are used within
    the ``_traverse_internals`` collection.   Such as, the :class:`.Case`
    object defines ``_traverse_internals`` as ::

        class Case(ColumnElement[_T]):
            _traverse_internals = [
                ("value", InternalTraversal.dp_clauseelement),
                ("whens", InternalTraversal.dp_clauseelement_tuples),
                ("else_", InternalTraversal.dp_clauseelement),
            ]

    Above, the :class:`.Case` class indicates its internal state as the
    attributes named ``value``, ``whens``, and ``else_``.    They each
    link to an :class:`.InternalTraversal` method which indicates the type
    of datastructure to which each attribute refers.

    Using the ``_traverse_internals`` structure, objects of type
    :class:`.InternalTraversible` will have the following methods automatically
    implemented:

    * :meth:`.HasTraverseInternals.get_children`

    * :meth:`.HasTraverseInternals._copy_internals`

    * :meth:`.HasCacheKey._gen_cache_key`

    Subclasses can also implement these methods directly, particularly for the
    :meth:`.HasTraverseInternals._copy_internals` method, when special steps
    are needed.

    .. versionadded:: 1.4

    """

    dp_has_cache_key = "HC"
    """Visit a :class:`.HasCacheKey` object."""

    dp_has_cache_key_list = "HL"
    """Visit a list of :class:`.HasCacheKey` objects."""

    dp_clauseelement = "CE"
    """Visit a :class:`_expression.ClauseElement` object."""

    dp_fromclause_canonical_column_collection = "FC"
    """Visit a :class:`_expression.FromClause` object in the context of the
    ``columns`` attribute.

    The column collection is "canonical", meaning it is the originally
    defined location of the :class:`.ColumnClause` objects.   Right now
    this means that the object being visited is a
    :class:`_expression.TableClause`
    or :class:`_schema.Table` object only.

    """

    dp_clauseelement_tuples = "CTS"
    """Visit a list of tuples which contain :class:`_expression.ClauseElement`
    objects.

    """

    dp_clauseelement_list = "CL"
    """Visit a list of :class:`_expression.ClauseElement` objects.

    """

    dp_clauseelement_tuple = "CT"
    """Visit a tuple of :class:`_expression.ClauseElement` objects.

    """

    dp_executable_options = "EO"

    dp_with_context_options = "WC"

    dp_fromclause_ordered_set = "CO"
    """Visit an ordered set of :class:`_expression.FromClause` objects. """

    dp_string = "S"
    """Visit a plain string value.

    Examples include table and column names, bound parameter keys, special
    keywords such as "UNION", "UNION ALL".

    The string value is considered to be significant for cache key
    generation.

    """

    dp_string_list = "SL"
    """Visit a list of strings."""

    dp_anon_name = "AN"
    """Visit a potentially "anonymized" string value.

    The string value is considered to be significant for cache key
    generation.

    """

    dp_boolean = "B"
    """Visit a boolean value.

    The boolean value is considered to be significant for cache key
    generation.

    """

    dp_operator = "O"
    """Visit an operator.

    The operator is a function from the :mod:`sqlalchemy.sql.operators`
    module.

    The operator value is considered to be significant for cache key
    generation.

    """

    dp_type = "T"
    """Visit a :class:`.TypeEngine` object

    The type object is considered to be significant for cache key
    generation.

    """

    dp_plain_dict = "PD"
    """Visit a dictionary with string keys.

    The keys of the dictionary should be strings, the values should
    be immutable and hashable.   The dictionary is considered to be
    significant for cache key generation.

    """

    dp_dialect_options = "DO"
    """Visit a dialect options structure."""

    dp_string_clauseelement_dict = "CD"
    """Visit a dictionary of string keys to :class:`_expression.ClauseElement`
    objects.

    """

    dp_string_multi_dict = "MD"
    """Visit a dictionary of string keys to values which may either be
    plain immutable/hashable or :class:`.HasCacheKey` objects.

    """

    dp_annotations_key = "AK"
    """Visit the _annotations_cache_key element.

    This is a dictionary of additional information about a ClauseElement
    that modifies its role.  It should be included when comparing or caching
    objects, however generating this key is relatively expensive.   Visitors
    should check the "_annotations" dict for non-None first before creating
    this key.

    """

    dp_plain_obj = "PO"
    """Visit a plain python object.

    The value should be immutable and hashable, such as an integer.
    The value is considered to be significant for cache key generation.

    """

    dp_named_ddl_element = "DD"
    """Visit a simple named DDL element.

    The current object used by this method is the :class:`.Sequence`.

    The object is only considered to be important for cache key generation
    as far as its name, but not any other aspects of it.

    """

    dp_prefix_sequence = "PS"
    """Visit the sequence represented by :class:`_expression.HasPrefixes`
    or :class:`_expression.HasSuffixes`.

    """

    dp_table_hint_list = "TH"
    """Visit the ``_hints`` collection of a :class:`_expression.Select`
    object.

    """

    dp_setup_join_tuple = "SJ"

    dp_memoized_select_entities = "ME"

    dp_statement_hint_list = "SH"
    """Visit the ``_statement_hints`` collection of a
    :class:`_expression.Select`
    object.

    """

    dp_unknown_structure = "UK"
    """Visit an unknown structure.

    """

    dp_dml_ordered_values = "DML_OV"
    """Visit the values() ordered tuple list of an
    :class:`_expression.Update` object."""

    dp_dml_values = "DML_V"
    """Visit the values() dictionary of a :class:`.ValuesBase`
    (e.g. Insert or Update) object.

    """

    dp_dml_multi_values = "DML_MV"
    """Visit the values() multi-valued list of dictionaries of an
    :class:`_expression.Insert` object.

    """

    dp_propagate_attrs = "PA"
    """Visit the propagate attrs dict.  This hardcodes to the particular
    elements we care about right now."""

    """Symbols that follow are additional symbols that are useful in
    caching applications.

    Traversals for :class:`_expression.ClauseElement` objects only need to use
    those symbols present in :class:`.InternalTraversal`.  However, for
    additional caching use cases within the ORM, symbols dealing with the
    :class:`.HasCacheKey` class are added here.

    """

    dp_ignore = "IG"
    """Specify an object that should be ignored entirely.

    This currently applies function call argument caching where some
    arguments should not be considered to be part of a cache key.

    """

    dp_inspectable = "IS"
    """Visit an inspectable object where the return value is a
    :class:`.HasCacheKey` object."""

    dp_multi = "M"
    """Visit an object that may be a :class:`.HasCacheKey` or may be a
    plain hashable object."""

    dp_multi_list = "MT"
    """Visit a tuple containing elements that may be :class:`.HasCacheKey` or
    may be a plain hashable object."""

    dp_has_cache_key_tuples = "HT"
    """Visit a list of tuples which contain :class:`.HasCacheKey`
    objects.

    """

    dp_inspectable_list = "IL"
    """Visit a list of inspectable objects which upon inspection are
    HasCacheKey objects."""


_TraverseInternalsType = List[Tuple[str, InternalTraversal]]
"""a structure that defines how a HasTraverseInternals should be
traversed.

This structure consists of a list of (attributename, internaltraversal)
tuples, where the "attributename" refers to the name of an attribute on an
instance of the HasTraverseInternals object, and "internaltraversal" refers
to an :class:`.InternalTraversal` enumeration symbol defining what kind
of data this attribute stores, which indicates to the traverser how it should
be handled.

"""


class HasTraverseInternals:
    """base for classes that have a "traverse internals" element,
    which defines all kinds of ways of traversing the elements of an object.

    Compared to :class:`.Visitable`, which relies upon an external visitor to
    define how the object is travered (i.e. the :class:`.SQLCompiler`), the
    :class:`.HasTraverseInternals` interface allows classes to define their own
    traversal, that is, what attributes are accessed and in what order.

    """

    __slots__ = ()

    _traverse_internals: _TraverseInternalsType

    _is_immutable: bool = False

    @util.preload_module("sqlalchemy.sql.traversals")
    def get_children(
        self, *, omit_attrs: Tuple[str, ...] = (), **kw: Any
    ) -> Iterable[HasTraverseInternals]:
        r"""Return immediate child :class:`.visitors.HasTraverseInternals`
        elements of this :class:`.visitors.HasTraverseInternals`.

        This is used for visit traversal.

        \**kw may contain flags that change the collection that is
        returned, for example to return a subset of items in order to
        cut down on larger traversals, or to return child items from a
        different context (such as schema-level collections instead of
        clause-level).

        """

        traversals = util.preloaded.sql_traversals

        try:
            traverse_internals = self._traverse_internals
        except AttributeError:
            # user-defined classes may not have a _traverse_internals
            return []

        dispatch = traversals._get_children.run_generated_dispatch
        return itertools.chain.from_iterable(
            meth(obj, **kw)
            for attrname, obj, meth in dispatch(
                self, traverse_internals, "_generated_get_children_traversal"
            )
            if attrname not in omit_attrs and obj is not None
        )


class _InternalTraversalDispatchType(Protocol):
    def __call__(s, self: object, visitor: HasTraversalDispatch) -> Any:
        ...


class HasTraversalDispatch:
    r"""Define infrastructure for classes that perform internal traversals

    .. versionadded:: 2.0

    """

    __slots__ = ()

    _dispatch_lookup: ClassVar[Dict[Union[InternalTraversal, str], str]] = {}

    def dispatch(self, visit_symbol: InternalTraversal) -> Callable[..., Any]:
        """Given a method from :class:`.HasTraversalDispatch`, return the
        corresponding method on a subclass.

        """
        name = _dispatch_lookup[visit_symbol]
        return getattr(self, name, None)  # type: ignore

    def run_generated_dispatch(
        self,
        target: object,
        internal_dispatch: _TraverseInternalsType,
        generate_dispatcher_name: str,
    ) -> Any:
        dispatcher: _InternalTraversalDispatchType
        try:
            dispatcher = target.__class__.__dict__[generate_dispatcher_name]
        except KeyError:
            # traversals.py -> _preconfigure_traversals()
            # may be used to run these ahead of time, but
            # is not enabled right now.
            # this block will generate any remaining dispatchers.
            dispatcher = self.generate_dispatch(
                target.__class__, internal_dispatch, generate_dispatcher_name
            )
        return dispatcher(target, self)

    def generate_dispatch(
        self,
        target_cls: Type[object],
        internal_dispatch: _TraverseInternalsType,
        generate_dispatcher_name: str,
    ) -> _InternalTraversalDispatchType:
        dispatcher = self._generate_dispatcher(
            internal_dispatch, generate_dispatcher_name
        )
        # assert isinstance(target_cls, type)
        setattr(target_cls, generate_dispatcher_name, dispatcher)
        return dispatcher

    def _generate_dispatcher(
        self, internal_dispatch: _TraverseInternalsType, method_name: str
    ) -> _InternalTraversalDispatchType:
        names = []
        for attrname, visit_sym in internal_dispatch:
            meth = self.dispatch(visit_sym)
            if meth is not None:
                visit_name = _dispatch_lookup[visit_sym]
                names.append((attrname, visit_name))

        code = (
            ("    return [\n")
            + (
                ", \n".join(
                    "        (%r, self.%s, visitor.%s)"
                    % (attrname, attrname, visit_name)
                    for attrname, visit_name in names
                )
            )
            + ("\n    ]\n")
        )
        meth_text = ("def %s(self, visitor):\n" % method_name) + code + "\n"
        return cast(
            _InternalTraversalDispatchType,
            langhelpers._exec_code_in_env(meth_text, {}, method_name),
        )


ExtendedInternalTraversal = InternalTraversal


def _generate_traversal_dispatch() -> None:
    lookup = _dispatch_lookup

    for sym in InternalTraversal:
        key = sym.name
        if key.startswith("dp_"):
            visit_key = key.replace("dp_", "visit_")
            sym_name = sym.value
            assert sym_name not in lookup, sym_name
            lookup[sym] = lookup[sym_name] = visit_key


_dispatch_lookup = HasTraversalDispatch._dispatch_lookup
_generate_traversal_dispatch()


class ExternallyTraversible(HasTraverseInternals, Visitable):
    __slots__ = ()

    _annotations: Mapping[Any, Any] = util.EMPTY_DICT

    if typing.TYPE_CHECKING:

        def _annotate(self, values: _AnnotationDict) -> Self:
            ...

        def get_children(
            self, *, omit_attrs: Tuple[str, ...] = (), **kw: Any
        ) -> Iterable[ExternallyTraversible]:
            ...

    def _clone(self, **kw: Any) -> Self:
        """clone this element"""
        raise NotImplementedError()

    def _copy_internals(
        self, *, omit_attrs: Tuple[str, ...] = (), **kw: Any
    ) -> None:
        """Reassign internal elements to be clones of themselves.

        Called during a copy-and-traverse operation on newly
        shallow-copied elements to create a deep copy.

        The given clone function should be used, which may be applying
        additional transformations to the element (i.e. replacement
        traversal, cloned traversal, annotations).

        """
        raise NotImplementedError()


_ET = TypeVar("_ET", bound=ExternallyTraversible)

_CE = TypeVar("_CE", bound="ColumnElement[Any]")

_TraverseCallableType = Callable[[_ET], None]


class _CloneCallableType(Protocol):
    def __call__(self, element: _ET, **kw: Any) -> _ET:
        ...


class _TraverseTransformCallableType(Protocol[_ET]):
    def __call__(self, element: _ET, **kw: Any) -> Optional[_ET]:
        ...


_ExtT = TypeVar("_ExtT", bound="ExternalTraversal")


class ExternalTraversal(util.MemoizedSlots):
    """Base class for visitor objects which can traverse externally using
    the :func:`.visitors.traverse` function.

    Direct usage of the :func:`.visitors.traverse` function is usually
    preferred.

    """

    __slots__ = ("_visitor_dict", "_next")

    __traverse_options__: Dict[str, Any] = {}
    _next: Optional[ExternalTraversal]

    def traverse_single(self, obj: Visitable, **kw: Any) -> Any:
        for v in self.visitor_iterator:
            meth = getattr(v, "visit_%s" % obj.__visit_name__, None)
            if meth:
                return meth(obj, **kw)

    def iterate(
        self, obj: Optional[ExternallyTraversible]
    ) -> Iterator[ExternallyTraversible]:
        """Traverse the given expression structure, returning an iterator
        of all elements.

        """
        return iterate(obj, self.__traverse_options__)

    @overload
    def traverse(self, obj: Literal[None]) -> None:
        ...

    @overload
    def traverse(self, obj: ExternallyTraversible) -> ExternallyTraversible:
        ...

    def traverse(
        self, obj: Optional[ExternallyTraversible]
    ) -> Optional[ExternallyTraversible]:
        """Traverse and visit the given expression structure."""

        return traverse(obj, self.__traverse_options__, self._visitor_dict)

    def _memoized_attr__visitor_dict(
        self,
    ) -> Dict[str, _TraverseCallableType[Any]]:
        visitors = {}

        for name in dir(self):
            if name.startswith("visit_"):
                visitors[name[6:]] = getattr(self, name)
        return visitors

    @property
    def visitor_iterator(self) -> Iterator[ExternalTraversal]:
        """Iterate through this visitor and each 'chained' visitor."""

        v: Optional[ExternalTraversal] = self
        while v:
            yield v
            v = getattr(v, "_next", None)

    def chain(self: _ExtT, visitor: ExternalTraversal) -> _ExtT:
        """'Chain' an additional ExternalTraversal onto this ExternalTraversal

        The chained visitor will receive all visit events after this one.

        """
        tail = list(self.visitor_iterator)[-1]
        tail._next = visitor
        return self


class CloningExternalTraversal(ExternalTraversal):
    """Base class for visitor objects which can traverse using
    the :func:`.visitors.cloned_traverse` function.

    Direct usage of the :func:`.visitors.cloned_traverse` function is usually
    preferred.


    """

    __slots__ = ()

    def copy_and_process(
        self, list_: List[ExternallyTraversible]
    ) -> List[ExternallyTraversible]:
        """Apply cloned traversal to the given list of elements, and return
        the new list.

        """
        return [self.traverse(x) for x in list_]

    @overload
    def traverse(self, obj: Literal[None]) -> None:
        ...

    @overload
    def traverse(self, obj: ExternallyTraversible) -> ExternallyTraversible:
        ...

    def traverse(
        self, obj: Optional[ExternallyTraversible]
    ) -> Optional[ExternallyTraversible]:
        """Traverse and visit the given expression structure."""

        return cloned_traverse(
            obj, self.__traverse_options__, self._visitor_dict
        )


class ReplacingExternalTraversal(CloningExternalTraversal):
    """Base class for visitor objects which can traverse using
    the :func:`.visitors.replacement_traverse` function.

    Direct usage of the :func:`.visitors.replacement_traverse` function is
    usually preferred.

    """

    __slots__ = ()

    def replace(
        self, elem: ExternallyTraversible
    ) -> Optional[ExternallyTraversible]:
        """Receive pre-copied elements during a cloning traversal.

        If the method returns a new element, the element is used
        instead of creating a simple copy of the element.  Traversal
        will halt on the newly returned element if it is re-encountered.
        """
        return None

    @overload
    def traverse(self, obj: Literal[None]) -> None:
        ...

    @overload
    def traverse(self, obj: ExternallyTraversible) -> ExternallyTraversible:
        ...

    def traverse(
        self, obj: Optional[ExternallyTraversible]
    ) -> Optional[ExternallyTraversible]:
        """Traverse and visit the given expression structure."""

        def replace(
            element: ExternallyTraversible,
            **kw: Any,
        ) -> Optional[ExternallyTraversible]:
            for v in self.visitor_iterator:
                e = cast(ReplacingExternalTraversal, v).replace(element)
                if e is not None:
                    return e

            return None

        return replacement_traverse(obj, self.__traverse_options__, replace)


# backwards compatibility
Traversible = Visitable

ClauseVisitor = ExternalTraversal
CloningVisitor = CloningExternalTraversal
ReplacingCloningVisitor = ReplacingExternalTraversal


def iterate(
    obj: Optional[ExternallyTraversible],
    opts: Mapping[str, Any] = util.EMPTY_DICT,
) -> Iterator[ExternallyTraversible]:
    r"""Traverse the given expression structure, returning an iterator.

    Traversal is configured to be breadth-first.

    The central API feature used by the :func:`.visitors.iterate`
    function is the
    :meth:`_expression.ClauseElement.get_children` method of
    :class:`_expression.ClauseElement` objects.  This method should return all
    the :class:`_expression.ClauseElement` objects which are associated with a
    particular :class:`_expression.ClauseElement` object. For example, a
    :class:`.Case` structure will refer to a series of
    :class:`_expression.ColumnElement` objects within its "whens" and "else\_"
    member variables.

    :param obj: :class:`_expression.ClauseElement` structure to be traversed

    :param opts: dictionary of iteration options.   This dictionary is usually
     empty in modern usage.

    """
    if obj is None:
        return

    yield obj
    children = obj.get_children(**opts)

    if not children:
        return

    stack = deque([children])
    while stack:
        t_iterator = stack.popleft()
        for t in t_iterator:
            yield t
            stack.append(t.get_children(**opts))


@overload
def traverse_using(
    iterator: Iterable[ExternallyTraversible],
    obj: Literal[None],
    visitors: Mapping[str, _TraverseCallableType[Any]],
) -> None:
    ...


@overload
def traverse_using(
    iterator: Iterable[ExternallyTraversible],
    obj: ExternallyTraversible,
    visitors: Mapping[str, _TraverseCallableType[Any]],
) -> ExternallyTraversible:
    ...


def traverse_using(
    iterator: Iterable[ExternallyTraversible],
    obj: Optional[ExternallyTraversible],
    visitors: Mapping[str, _TraverseCallableType[Any]],
) -> Optional[ExternallyTraversible]:
    """Visit the given expression structure using the given iterator of
    objects.

    :func:`.visitors.traverse_using` is usually called internally as the result
    of the :func:`.visitors.traverse` function.

    :param iterator: an iterable or sequence which will yield
     :class:`_expression.ClauseElement`
     structures; the iterator is assumed to be the
     product of the :func:`.visitors.iterate` function.

    :param obj: the :class:`_expression.ClauseElement`
     that was used as the target of the
     :func:`.iterate` function.

    :param visitors: dictionary of visit functions.  See :func:`.traverse`
     for details on this dictionary.

    .. seealso::

        :func:`.traverse`


    """
    for target in iterator:
        meth = visitors.get(target.__visit_name__, None)
        if meth:
            meth(target)
    return obj


@overload
def traverse(
    obj: Literal[None],
    opts: Mapping[str, Any],
    visitors: Mapping[str, _TraverseCallableType[Any]],
) -> None:
    ...


@overload
def traverse(
    obj: ExternallyTraversible,
    opts: Mapping[str, Any],
    visitors: Mapping[str, _TraverseCallableType[Any]],
) -> ExternallyTraversible:
    ...


def traverse(
    obj: Optional[ExternallyTraversible],
    opts: Mapping[str, Any],
    visitors: Mapping[str, _TraverseCallableType[Any]],
) -> Optional[ExternallyTraversible]:
    """Traverse and visit the given expression structure using the default
    iterator.

     e.g.::

        from sqlalchemy.sql import visitors

        stmt = select(some_table).where(some_table.c.foo == 'bar')

        def visit_bindparam(bind_param):
            print("found bound value: %s" % bind_param.value)

        visitors.traverse(stmt, {}, {"bindparam": visit_bindparam})

    The iteration of objects uses the :func:`.visitors.iterate` function,
    which does a breadth-first traversal using a stack.

    :param obj: :class:`_expression.ClauseElement` structure to be traversed

    :param opts: dictionary of iteration options.   This dictionary is usually
     empty in modern usage.

    :param visitors: dictionary of visit functions.   The dictionary should
     have strings as keys, each of which would correspond to the
     ``__visit_name__`` of a particular kind of SQL expression object, and
     callable functions  as values, each of which represents a visitor function
     for that kind of object.

    """
    return traverse_using(iterate(obj, opts), obj, visitors)


@overload
def cloned_traverse(
    obj: Literal[None],
    opts: Mapping[str, Any],
    visitors: Mapping[str, _TraverseCallableType[Any]],
) -> None:
    ...


# a bit of controversy here, as the clone of the lead element
# *could* in theory replace with an entirely different kind of element.
# however this is really not how cloned_traverse is ever used internally
# at least.
@overload
def cloned_traverse(
    obj: _ET,
    opts: Mapping[str, Any],
    visitors: Mapping[str, _TraverseCallableType[Any]],
) -> _ET:
    ...


def cloned_traverse(
    obj: Optional[ExternallyTraversible],
    opts: Mapping[str, Any],
    visitors: Mapping[str, _TraverseCallableType[Any]],
) -> Optional[ExternallyTraversible]:
    """Clone the given expression structure, allowing modifications by
    visitors for mutable objects.

    Traversal usage is the same as that of :func:`.visitors.traverse`.
    The visitor functions present in the ``visitors`` dictionary may also
    modify the internals of the given structure as the traversal proceeds.

    The :func:`.cloned_traverse` function does **not** provide objects that are
    part of the :class:`.Immutable` interface to the visit methods (this
    primarily includes :class:`.ColumnClause`, :class:`.Column`,
    :class:`.TableClause` and :class:`.Table` objects). As this traversal is
    only intended to allow in-place mutation of objects, :class:`.Immutable`
    objects are skipped. The :meth:`.Immutable._clone` method is still called
    on each object to allow for objects to replace themselves with a different
    object based on a clone of their sub-internals (e.g. a
    :class:`.ColumnClause` that clones its subquery to return a new
    :class:`.ColumnClause`).

    .. versionchanged:: 2.0  The :func:`.cloned_traverse` function omits
       objects that are part of the :class:`.Immutable` interface.

    The central API feature used by the :func:`.visitors.cloned_traverse`
    and :func:`.visitors.replacement_traverse` functions, in addition to the
    :meth:`_expression.ClauseElement.get_children`
    function that is used to achieve
    the iteration, is the :meth:`_expression.ClauseElement._copy_internals`
    method.
    For a :class:`_expression.ClauseElement`
    structure to support cloning and replacement
    traversals correctly, it needs to be able to pass a cloning function into
    its internal members in order to make copies of them.

    .. seealso::

        :func:`.visitors.traverse`

        :func:`.visitors.replacement_traverse`

    """

    cloned: Dict[int, ExternallyTraversible] = {}
    stop_on = set(opts.get("stop_on", []))

    def deferred_copy_internals(
        obj: ExternallyTraversible,
    ) -> ExternallyTraversible:
        return cloned_traverse(obj, opts, visitors)

    def clone(elem: ExternallyTraversible, **kw: Any) -> ExternallyTraversible:
        if elem in stop_on:
            return elem
        else:
            if id(elem) not in cloned:
                if "replace" in kw:
                    newelem = cast(
                        Optional[ExternallyTraversible], kw["replace"](elem)
                    )
                    if newelem is not None:
                        cloned[id(elem)] = newelem
                        return newelem

                # the _clone method for immutable normally returns "self".
                # however, the method is still allowed to return a
                # different object altogether; ColumnClause._clone() will
                # based on options clone the subquery to which it is associated
                # and return the new corresponding column.
                cloned[id(elem)] = newelem = elem._clone(clone=clone, **kw)
                newelem._copy_internals(clone=clone, **kw)

                # however, visit methods which are tasked with in-place
                # mutation of the object should not get access to the immutable
                # object.
                if not elem._is_immutable:
                    meth = visitors.get(newelem.__visit_name__, None)
                    if meth:
                        meth(newelem)
            return cloned[id(elem)]

    if obj is not None:
        obj = clone(
            obj, deferred_copy_internals=deferred_copy_internals, **opts
        )
    clone = None  # type: ignore[assignment]  # remove gc cycles
    return obj


@overload
def replacement_traverse(
    obj: Literal[None],
    opts: Mapping[str, Any],
    replace: _TraverseTransformCallableType[Any],
) -> None:
    ...


@overload
def replacement_traverse(
    obj: _CE,
    opts: Mapping[str, Any],
    replace: _TraverseTransformCallableType[Any],
) -> _CE:
    ...


@overload
def replacement_traverse(
    obj: ExternallyTraversible,
    opts: Mapping[str, Any],
    replace: _TraverseTransformCallableType[Any],
) -> ExternallyTraversible:
    ...


def replacement_traverse(
    obj: Optional[ExternallyTraversible],
    opts: Mapping[str, Any],
    replace: _TraverseTransformCallableType[Any],
) -> Optional[ExternallyTraversible]:
    """Clone the given expression structure, allowing element
    replacement by a given replacement function.

    This function is very similar to the :func:`.visitors.cloned_traverse`
    function, except instead of being passed a dictionary of visitors, all
    elements are unconditionally passed into the given replace function.
    The replace function then has the option to return an entirely new object
    which will replace the one given.  If it returns ``None``, then the object
    is kept in place.

    The difference in usage between :func:`.visitors.cloned_traverse` and
    :func:`.visitors.replacement_traverse` is that in the former case, an
    already-cloned object is passed to the visitor function, and the visitor
    function can then manipulate the internal state of the object.
    In the case of the latter, the visitor function should only return an
    entirely different object, or do nothing.

    The use case for :func:`.visitors.replacement_traverse` is that of
    replacing a FROM clause inside of a SQL structure with a different one,
    as is a common use case within the ORM.

    """

    cloned = {}
    stop_on = {id(x) for x in opts.get("stop_on", [])}

    def deferred_copy_internals(
        obj: ExternallyTraversible,
    ) -> ExternallyTraversible:
        return replacement_traverse(obj, opts, replace)

    def clone(elem: ExternallyTraversible, **kw: Any) -> ExternallyTraversible:
        if (
            id(elem) in stop_on
            or "no_replacement_traverse" in elem._annotations
        ):
            return elem
        else:
            newelem = replace(elem)
            if newelem is not None:
                stop_on.add(id(newelem))
                return newelem  # type: ignore
            else:
                # base "already seen" on id(), not hash, so that we don't
                # replace an Annotated element with its non-annotated one, and
                # vice versa
                id_elem = id(elem)
                if id_elem not in cloned:
                    if "replace" in kw:
                        newelem = kw["replace"](elem)
                        if newelem is not None:
                            cloned[id_elem] = newelem
                            return newelem  # type: ignore

                    cloned[id_elem] = newelem = elem._clone(**kw)
                    newelem._copy_internals(clone=clone, **kw)
                return cloned[id_elem]  # type: ignore

    if obj is not None:
        obj = clone(
            obj, deferred_copy_internals=deferred_copy_internals, **opts
        )
    clone = None  # type: ignore[assignment]  # remove gc cycles
    return obj
