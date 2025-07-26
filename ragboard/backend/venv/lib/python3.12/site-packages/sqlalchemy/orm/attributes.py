# orm/attributes.py
# Copyright (C) 2005-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php
# mypy: allow-untyped-defs, allow-untyped-calls

"""Defines instrumentation for class attributes and their interaction
with instances.

This module is usually not directly visible to user applications, but
defines a large part of the ORM's interactivity.


"""

from __future__ import annotations

import dataclasses
import operator
from typing import Any
from typing import Callable
from typing import cast
from typing import ClassVar
from typing import Dict
from typing import Iterable
from typing import List
from typing import NamedTuple
from typing import Optional
from typing import overload
from typing import Sequence
from typing import Tuple
from typing import Type
from typing import TYPE_CHECKING
from typing import TypeVar
from typing import Union

from . import collections
from . import exc as orm_exc
from . import interfaces
from ._typing import insp_is_aliased_class
from .base import _DeclarativeMapped
from .base import ATTR_EMPTY
from .base import ATTR_WAS_SET
from .base import CALLABLES_OK
from .base import DEFERRED_HISTORY_LOAD
from .base import INCLUDE_PENDING_MUTATIONS  # noqa
from .base import INIT_OK
from .base import instance_dict as instance_dict
from .base import instance_state as instance_state
from .base import instance_str
from .base import LOAD_AGAINST_COMMITTED
from .base import LoaderCallableStatus
from .base import manager_of_class as manager_of_class
from .base import Mapped as Mapped  # noqa
from .base import NEVER_SET  # noqa
from .base import NO_AUTOFLUSH
from .base import NO_CHANGE  # noqa
from .base import NO_KEY
from .base import NO_RAISE
from .base import NO_VALUE
from .base import NON_PERSISTENT_OK  # noqa
from .base import opt_manager_of_class as opt_manager_of_class
from .base import PASSIVE_CLASS_MISMATCH  # noqa
from .base import PASSIVE_NO_FETCH
from .base import PASSIVE_NO_FETCH_RELATED  # noqa
from .base import PASSIVE_NO_INITIALIZE
from .base import PASSIVE_NO_RESULT
from .base import PASSIVE_OFF
from .base import PASSIVE_ONLY_PERSISTENT
from .base import PASSIVE_RETURN_NO_VALUE
from .base import PassiveFlag
from .base import RELATED_OBJECT_OK  # noqa
from .base import SQL_OK  # noqa
from .base import SQLORMExpression
from .base import state_str
from .. import event
from .. import exc
from .. import inspection
from .. import util
from ..event import dispatcher
from ..event import EventTarget
from ..sql import base as sql_base
from ..sql import cache_key
from ..sql import coercions
from ..sql import roles
from ..sql import visitors
from ..sql.cache_key import HasCacheKey
from ..sql.visitors import _TraverseInternalsType
from ..sql.visitors import InternalTraversal
from ..util.typing import Literal
from ..util.typing import Self
from ..util.typing import TypeGuard

if TYPE_CHECKING:
    from ._typing import _EntityType
    from ._typing import _ExternalEntityType
    from ._typing import _InstanceDict
    from ._typing import _InternalEntityType
    from ._typing import _LoaderCallable
    from ._typing import _O
    from .collections import _AdaptedCollectionProtocol
    from .collections import CollectionAdapter
    from .interfaces import MapperProperty
    from .relationships import RelationshipProperty
    from .state import InstanceState
    from .util import AliasedInsp
    from .writeonly import WriteOnlyAttributeImpl
    from ..event.base import _Dispatch
    from ..sql._typing import _ColumnExpressionArgument
    from ..sql._typing import _DMLColumnArgument
    from ..sql._typing import _InfoType
    from ..sql._typing import _PropagateAttrsType
    from ..sql.annotation import _AnnotationDict
    from ..sql.elements import ColumnElement
    from ..sql.elements import Label
    from ..sql.operators import OperatorType
    from ..sql.selectable import FromClause


_T = TypeVar("_T")
_T_co = TypeVar("_T_co", bound=Any, covariant=True)


_AllPendingType = Sequence[
    Tuple[Optional["InstanceState[Any]"], Optional[object]]
]


_UNKNOWN_ATTR_KEY = object()


@inspection._self_inspects
class QueryableAttribute(
    _DeclarativeMapped[_T_co],
    SQLORMExpression[_T_co],
    interfaces.InspectionAttr,
    interfaces.PropComparator[_T_co],
    roles.JoinTargetRole,
    roles.OnClauseRole,
    sql_base.Immutable,
    cache_key.SlotsMemoizedHasCacheKey,
    util.MemoizedSlots,
    EventTarget,
):
    """Base class for :term:`descriptor` objects that intercept
    attribute events on behalf of a :class:`.MapperProperty`
    object.  The actual :class:`.MapperProperty` is accessible
    via the :attr:`.QueryableAttribute.property`
    attribute.


    .. seealso::

        :class:`.InstrumentedAttribute`

        :class:`.MapperProperty`

        :attr:`_orm.Mapper.all_orm_descriptors`

        :attr:`_orm.Mapper.attrs`
    """

    __slots__ = (
        "class_",
        "key",
        "impl",
        "comparator",
        "property",
        "parent",
        "expression",
        "_of_type",
        "_extra_criteria",
        "_slots_dispatch",
        "_propagate_attrs",
        "_doc",
    )

    is_attribute = True

    dispatch: dispatcher[QueryableAttribute[_T_co]]

    class_: _ExternalEntityType[Any]
    key: str
    parententity: _InternalEntityType[Any]
    impl: AttributeImpl
    comparator: interfaces.PropComparator[_T_co]
    _of_type: Optional[_InternalEntityType[Any]]
    _extra_criteria: Tuple[ColumnElement[bool], ...]
    _doc: Optional[str]

    # PropComparator has a __visit_name__ to participate within
    # traversals.   Disambiguate the attribute vs. a comparator.
    __visit_name__ = "orm_instrumented_attribute"

    def __init__(
        self,
        class_: _ExternalEntityType[_O],
        key: str,
        parententity: _InternalEntityType[_O],
        comparator: interfaces.PropComparator[_T_co],
        impl: Optional[AttributeImpl] = None,
        of_type: Optional[_InternalEntityType[Any]] = None,
        extra_criteria: Tuple[ColumnElement[bool], ...] = (),
    ):
        self.class_ = class_
        self.key = key

        self._parententity = self.parent = parententity

        # this attribute is non-None after mappers are set up, however in the
        # interim class manager setup, there's a check for None to see if it
        # needs to be populated, so we assign None here leaving the attribute
        # in a temporarily not-type-correct state
        self.impl = impl  # type: ignore

        assert comparator is not None
        self.comparator = comparator
        self._of_type = of_type
        self._extra_criteria = extra_criteria
        self._doc = None

        manager = opt_manager_of_class(class_)
        # manager is None in the case of AliasedClass
        if manager:
            # propagate existing event listeners from
            # immediate superclass
            for base in manager._bases:
                if key in base:
                    self.dispatch._update(base[key].dispatch)
                    if base[key].dispatch._active_history:
                        self.dispatch._active_history = True  # type: ignore

    _cache_key_traversal = [
        ("key", visitors.ExtendedInternalTraversal.dp_string),
        ("_parententity", visitors.ExtendedInternalTraversal.dp_multi),
        ("_of_type", visitors.ExtendedInternalTraversal.dp_multi),
        ("_extra_criteria", visitors.InternalTraversal.dp_clauseelement_list),
    ]

    def __reduce__(self) -> Any:
        # this method is only used in terms of the
        # sqlalchemy.ext.serializer extension
        return (
            _queryable_attribute_unreduce,
            (
                self.key,
                self._parententity.mapper.class_,
                self._parententity,
                self._parententity.entity,
            ),
        )

    @property
    def _impl_uses_objects(self) -> bool:
        return self.impl.uses_objects

    def get_history(
        self, instance: Any, passive: PassiveFlag = PASSIVE_OFF
    ) -> History:
        return self.impl.get_history(
            instance_state(instance), instance_dict(instance), passive
        )

    @property
    def info(self) -> _InfoType:
        """Return the 'info' dictionary for the underlying SQL element.

        The behavior here is as follows:

        * If the attribute is a column-mapped property, i.e.
          :class:`.ColumnProperty`, which is mapped directly
          to a schema-level :class:`_schema.Column` object, this attribute
          will return the :attr:`.SchemaItem.info` dictionary associated
          with the core-level :class:`_schema.Column` object.

        * If the attribute is a :class:`.ColumnProperty` but is mapped to
          any other kind of SQL expression other than a
          :class:`_schema.Column`,
          the attribute will refer to the :attr:`.MapperProperty.info`
          dictionary associated directly with the :class:`.ColumnProperty`,
          assuming the SQL expression itself does not have its own ``.info``
          attribute (which should be the case, unless a user-defined SQL
          construct has defined one).

        * If the attribute refers to any other kind of
          :class:`.MapperProperty`, including :class:`.Relationship`,
          the attribute will refer to the :attr:`.MapperProperty.info`
          dictionary associated with that :class:`.MapperProperty`.

        * To access the :attr:`.MapperProperty.info` dictionary of the
          :class:`.MapperProperty` unconditionally, including for a
          :class:`.ColumnProperty` that's associated directly with a
          :class:`_schema.Column`, the attribute can be referred to using
          :attr:`.QueryableAttribute.property` attribute, as
          ``MyClass.someattribute.property.info``.

        .. seealso::

            :attr:`.SchemaItem.info`

            :attr:`.MapperProperty.info`

        """
        return self.comparator.info

    parent: _InternalEntityType[Any]
    """Return an inspection instance representing the parent.

    This will be either an instance of :class:`_orm.Mapper`
    or :class:`.AliasedInsp`, depending upon the nature
    of the parent entity which this attribute is associated
    with.

    """

    expression: ColumnElement[_T_co]
    """The SQL expression object represented by this
    :class:`.QueryableAttribute`.

    This will typically be an instance of a :class:`_sql.ColumnElement`
    subclass representing a column expression.

    """

    def _memoized_attr_expression(self) -> ColumnElement[_T]:
        annotations: _AnnotationDict

        # applies only to Proxy() as used by hybrid.
        # currently is an exception to typing rather than feeding through
        # non-string keys.
        # ideally Proxy() would have a separate set of methods to deal
        # with this case.
        entity_namespace = self._entity_namespace
        assert isinstance(entity_namespace, HasCacheKey)

        if self.key is _UNKNOWN_ATTR_KEY:
            annotations = {"entity_namespace": entity_namespace}
        else:
            annotations = {
                "proxy_key": self.key,
                "proxy_owner": self._parententity,
                "entity_namespace": entity_namespace,
            }

        ce = self.comparator.__clause_element__()
        try:
            if TYPE_CHECKING:
                assert isinstance(ce, ColumnElement)
            anno = ce._annotate
        except AttributeError as ae:
            raise exc.InvalidRequestError(
                'When interpreting attribute "%s" as a SQL expression, '
                "expected __clause_element__() to return "
                "a ClauseElement object, got: %r" % (self, ce)
            ) from ae
        else:
            return anno(annotations)

    def _memoized_attr__propagate_attrs(self) -> _PropagateAttrsType:
        # this suits the case in coercions where we don't actually
        # call ``__clause_element__()`` but still need to get
        # resolved._propagate_attrs.  See #6558.
        return util.immutabledict(
            {
                "compile_state_plugin": "orm",
                "plugin_subject": self._parentmapper,
            }
        )

    @property
    def _entity_namespace(self) -> _InternalEntityType[Any]:
        return self._parententity

    @property
    def _annotations(self) -> _AnnotationDict:
        return self.__clause_element__()._annotations

    def __clause_element__(self) -> ColumnElement[_T_co]:
        return self.expression

    @property
    def _from_objects(self) -> List[FromClause]:
        return self.expression._from_objects

    def _bulk_update_tuples(
        self, value: Any
    ) -> Sequence[Tuple[_DMLColumnArgument, Any]]:
        """Return setter tuples for a bulk UPDATE."""

        return self.comparator._bulk_update_tuples(value)

    def adapt_to_entity(self, adapt_to_entity: AliasedInsp[Any]) -> Self:
        assert not self._of_type
        return self.__class__(
            adapt_to_entity.entity,
            self.key,
            impl=self.impl,
            comparator=self.comparator.adapt_to_entity(adapt_to_entity),
            parententity=adapt_to_entity,
        )

    def of_type(self, entity: _EntityType[Any]) -> QueryableAttribute[_T]:
        return QueryableAttribute(
            self.class_,
            self.key,
            self._parententity,
            impl=self.impl,
            comparator=self.comparator.of_type(entity),
            of_type=inspection.inspect(entity),
            extra_criteria=self._extra_criteria,
        )

    def and_(
        self, *clauses: _ColumnExpressionArgument[bool]
    ) -> QueryableAttribute[bool]:
        if TYPE_CHECKING:
            assert isinstance(self.comparator, RelationshipProperty.Comparator)

        exprs = tuple(
            coercions.expect(roles.WhereHavingRole, clause)
            for clause in util.coerce_generator_arg(clauses)
        )

        return QueryableAttribute(
            self.class_,
            self.key,
            self._parententity,
            impl=self.impl,
            comparator=self.comparator.and_(*exprs),
            of_type=self._of_type,
            extra_criteria=self._extra_criteria + exprs,
        )

    def _clone(self, **kw: Any) -> QueryableAttribute[_T]:
        return QueryableAttribute(
            self.class_,
            self.key,
            self._parententity,
            impl=self.impl,
            comparator=self.comparator,
            of_type=self._of_type,
            extra_criteria=self._extra_criteria,
        )

    def label(self, name: Optional[str]) -> Label[_T_co]:
        return self.__clause_element__().label(name)

    def operate(
        self, op: OperatorType, *other: Any, **kwargs: Any
    ) -> ColumnElement[Any]:
        return op(self.comparator, *other, **kwargs)  # type: ignore[no-any-return]  # noqa: E501

    def reverse_operate(
        self, op: OperatorType, other: Any, **kwargs: Any
    ) -> ColumnElement[Any]:
        return op(other, self.comparator, **kwargs)  # type: ignore[no-any-return]  # noqa: E501

    def hasparent(
        self, state: InstanceState[Any], optimistic: bool = False
    ) -> bool:
        return self.impl.hasparent(state, optimistic=optimistic) is not False

    def __getattr__(self, key: str) -> Any:
        try:
            return util.MemoizedSlots.__getattr__(self, key)
        except AttributeError:
            pass

        try:
            return getattr(self.comparator, key)
        except AttributeError as err:
            raise AttributeError(
                "Neither %r object nor %r object associated with %s "
                "has an attribute %r"
                % (
                    type(self).__name__,
                    type(self.comparator).__name__,
                    self,
                    key,
                )
            ) from err

    def __str__(self) -> str:
        return f"{self.class_.__name__}.{self.key}"

    def _memoized_attr_property(self) -> Optional[MapperProperty[Any]]:
        return self.comparator.property


def _queryable_attribute_unreduce(
    key: str,
    mapped_class: Type[_O],
    parententity: _InternalEntityType[_O],
    entity: _ExternalEntityType[Any],
) -> Any:
    # this method is only used in terms of the
    # sqlalchemy.ext.serializer extension
    if insp_is_aliased_class(parententity):
        return entity._get_from_serialized(key, mapped_class, parententity)
    else:
        return getattr(entity, key)


class InstrumentedAttribute(QueryableAttribute[_T]):
    """Class bound instrumented attribute which adds basic
    :term:`descriptor` methods.

    See :class:`.QueryableAttribute` for a description of most features.


    """

    __slots__ = ()

    inherit_cache = True
    """:meta private:"""

    # hack to make __doc__ writeable on instances of
    # InstrumentedAttribute, while still keeping classlevel
    # __doc__ correct

    @util.rw_hybridproperty
    def __doc__(self) -> Optional[str]:
        return self._doc

    @__doc__.setter  # type: ignore
    def __doc__(self, value: Optional[str]) -> None:
        self._doc = value

    @__doc__.classlevel  # type: ignore
    def __doc__(cls) -> Optional[str]:
        return super().__doc__

    def __set__(self, instance: object, value: Any) -> None:
        self.impl.set(
            instance_state(instance), instance_dict(instance), value, None
        )

    def __delete__(self, instance: object) -> None:
        self.impl.delete(instance_state(instance), instance_dict(instance))

    @overload
    def __get__(self, instance: None, owner: Any) -> InstrumentedAttribute[_T]:
        ...

    @overload
    def __get__(self, instance: object, owner: Any) -> _T:
        ...

    def __get__(
        self, instance: Optional[object], owner: Any
    ) -> Union[InstrumentedAttribute[_T], _T]:
        if instance is None:
            return self

        dict_ = instance_dict(instance)
        if self.impl.supports_population and self.key in dict_:
            return dict_[self.key]  # type: ignore[no-any-return]
        else:
            try:
                state = instance_state(instance)
            except AttributeError as err:
                raise orm_exc.UnmappedInstanceError(instance) from err
            return self.impl.get(state, dict_)  # type: ignore[no-any-return]


@dataclasses.dataclass(frozen=True)
class AdHocHasEntityNamespace(HasCacheKey):
    _traverse_internals: ClassVar[_TraverseInternalsType] = [
        ("_entity_namespace", InternalTraversal.dp_has_cache_key),
    ]

    # py37 compat, no slots=True on dataclass
    __slots__ = ("_entity_namespace",)
    _entity_namespace: _InternalEntityType[Any]
    is_mapper: ClassVar[bool] = False
    is_aliased_class: ClassVar[bool] = False

    @property
    def entity_namespace(self):
        return self._entity_namespace.entity_namespace


def create_proxied_attribute(
    descriptor: Any,
) -> Callable[..., QueryableAttribute[Any]]:
    """Create an QueryableAttribute / user descriptor hybrid.

    Returns a new QueryableAttribute type that delegates descriptor
    behavior and getattr() to the given descriptor.
    """

    # TODO: can move this to descriptor_props if the need for this
    # function is removed from ext/hybrid.py

    class Proxy(QueryableAttribute[Any]):
        """Presents the :class:`.QueryableAttribute` interface as a
        proxy on top of a Python descriptor / :class:`.PropComparator`
        combination.

        """

        _extra_criteria = ()

        # the attribute error catches inside of __getattr__ basically create a
        # singularity if you try putting slots on this too
        # __slots__ = ("descriptor", "original_property", "_comparator")

        def __init__(
            self,
            class_,
            key,
            descriptor,
            comparator,
            adapt_to_entity=None,
            doc=None,
            original_property=None,
        ):
            self.class_ = class_
            self.key = key
            self.descriptor = descriptor
            self.original_property = original_property
            self._comparator = comparator
            self._adapt_to_entity = adapt_to_entity
            self._doc = self.__doc__ = doc

        @property
        def _parententity(self):
            return inspection.inspect(self.class_, raiseerr=False)

        @property
        def parent(self):
            return inspection.inspect(self.class_, raiseerr=False)

        _is_internal_proxy = True

        _cache_key_traversal = [
            ("key", visitors.ExtendedInternalTraversal.dp_string),
            ("_parententity", visitors.ExtendedInternalTraversal.dp_multi),
        ]

        @property
        def _impl_uses_objects(self):
            return (
                self.original_property is not None
                and getattr(self.class_, self.key).impl.uses_objects
            )

        @property
        def _entity_namespace(self):
            if hasattr(self._comparator, "_parententity"):
                return self._comparator._parententity
            else:
                # used by hybrid attributes which try to remain
                # agnostic of any ORM concepts like mappers
                return AdHocHasEntityNamespace(self._parententity)

        @property
        def property(self):
            return self.comparator.property

        @util.memoized_property
        def comparator(self):
            if callable(self._comparator):
                self._comparator = self._comparator()
            if self._adapt_to_entity:
                self._comparator = self._comparator.adapt_to_entity(
                    self._adapt_to_entity
                )
            return self._comparator

        def adapt_to_entity(self, adapt_to_entity):
            return self.__class__(
                adapt_to_entity.entity,
                self.key,
                self.descriptor,
                self._comparator,
                adapt_to_entity,
            )

        def _clone(self, **kw):
            return self.__class__(
                self.class_,
                self.key,
                self.descriptor,
                self._comparator,
                adapt_to_entity=self._adapt_to_entity,
                original_property=self.original_property,
            )

        def __get__(self, instance, owner):
            retval = self.descriptor.__get__(instance, owner)
            # detect if this is a plain Python @property, which just returns
            # itself for class level access.  If so, then return us.
            # Otherwise, return the object returned by the descriptor.
            if retval is self.descriptor and instance is None:
                return self
            else:
                return retval

        def __str__(self) -> str:
            return f"{self.class_.__name__}.{self.key}"

        def __getattr__(self, attribute):
            """Delegate __getattr__ to the original descriptor and/or
            comparator."""

            # this is unfortunately very complicated, and is easily prone
            # to recursion overflows when implementations of related
            # __getattr__ schemes are changed

            try:
                return util.MemoizedSlots.__getattr__(self, attribute)
            except AttributeError:
                pass

            try:
                return getattr(descriptor, attribute)
            except AttributeError as err:
                if attribute == "comparator":
                    raise AttributeError("comparator") from err
                try:
                    # comparator itself might be unreachable
                    comparator = self.comparator
                except AttributeError as err2:
                    raise AttributeError(
                        "Neither %r object nor unconfigured comparator "
                        "object associated with %s has an attribute %r"
                        % (type(descriptor).__name__, self, attribute)
                    ) from err2
                else:
                    try:
                        return getattr(comparator, attribute)
                    except AttributeError as err3:
                        raise AttributeError(
                            "Neither %r object nor %r object "
                            "associated with %s has an attribute %r"
                            % (
                                type(descriptor).__name__,
                                type(comparator).__name__,
                                self,
                                attribute,
                            )
                        ) from err3

    Proxy.__name__ = type(descriptor).__name__ + "Proxy"

    util.monkeypatch_proxied_specials(
        Proxy, type(descriptor), name="descriptor", from_instance=descriptor
    )
    return Proxy


OP_REMOVE = util.symbol("REMOVE")
OP_APPEND = util.symbol("APPEND")
OP_REPLACE = util.symbol("REPLACE")
OP_BULK_REPLACE = util.symbol("BULK_REPLACE")
OP_MODIFIED = util.symbol("MODIFIED")


class AttributeEventToken:
    """A token propagated throughout the course of a chain of attribute
    events.

    Serves as an indicator of the source of the event and also provides
    a means of controlling propagation across a chain of attribute
    operations.

    The :class:`.Event` object is sent as the ``initiator`` argument
    when dealing with events such as :meth:`.AttributeEvents.append`,
    :meth:`.AttributeEvents.set`,
    and :meth:`.AttributeEvents.remove`.

    The :class:`.Event` object is currently interpreted by the backref
    event handlers, and is used to control the propagation of operations
    across two mutually-dependent attributes.

    .. versionchanged:: 2.0  Changed the name from ``AttributeEvent``
       to ``AttributeEventToken``.

    :attribute impl: The :class:`.AttributeImpl` which is the current event
     initiator.

    :attribute op: The symbol :attr:`.OP_APPEND`, :attr:`.OP_REMOVE`,
     :attr:`.OP_REPLACE`, or :attr:`.OP_BULK_REPLACE`, indicating the
     source operation.

    """

    __slots__ = "impl", "op", "parent_token"

    def __init__(self, attribute_impl: AttributeImpl, op: util.symbol):
        self.impl = attribute_impl
        self.op = op
        self.parent_token = self.impl.parent_token

    def __eq__(self, other):
        return (
            isinstance(other, AttributeEventToken)
            and other.impl is self.impl
            and other.op == self.op
        )

    @property
    def key(self):
        return self.impl.key

    def hasparent(self, state):
        return self.impl.hasparent(state)


AttributeEvent = AttributeEventToken  # legacy
Event = AttributeEventToken  # legacy


class AttributeImpl:
    """internal implementation for instrumented attributes."""

    collection: bool
    default_accepts_scalar_loader: bool
    uses_objects: bool
    supports_population: bool
    dynamic: bool

    _is_has_collection_adapter = False

    _replace_token: AttributeEventToken
    _remove_token: AttributeEventToken
    _append_token: AttributeEventToken

    def __init__(
        self,
        class_: _ExternalEntityType[_O],
        key: str,
        callable_: Optional[_LoaderCallable],
        dispatch: _Dispatch[QueryableAttribute[Any]],
        trackparent: bool = False,
        compare_function: Optional[Callable[..., bool]] = None,
        active_history: bool = False,
        parent_token: Optional[AttributeEventToken] = None,
        load_on_unexpire: bool = True,
        send_modified_events: bool = True,
        accepts_scalar_loader: Optional[bool] = None,
        **kwargs: Any,
    ):
        r"""Construct an AttributeImpl.

        :param \class_: associated class

        :param key: string name of the attribute

        :param \callable_:
          optional function which generates a callable based on a parent
          instance, which produces the "default" values for a scalar or
          collection attribute when it's first accessed, if not present
          already.

        :param trackparent:
          if True, attempt to track if an instance has a parent attached
          to it via this attribute.

        :param compare_function:
          a function that compares two values which are normally
          assignable to this attribute.

        :param active_history:
          indicates that get_history() should always return the "old" value,
          even if it means executing a lazy callable upon attribute change.

        :param parent_token:
          Usually references the MapperProperty, used as a key for
          the hasparent() function to identify an "owning" attribute.
          Allows multiple AttributeImpls to all match a single
          owner attribute.

        :param load_on_unexpire:
          if False, don't include this attribute in a load-on-expired
          operation, i.e. the "expired_attribute_loader" process.
          The attribute can still be in the "expired" list and be
          considered to be "expired".   Previously, this flag was called
          "expire_missing" and is only used by a deferred column
          attribute.

        :param send_modified_events:
          if False, the InstanceState._modified_event method will have no
          effect; this means the attribute will never show up as changed in a
          history entry.

        """
        self.class_ = class_
        self.key = key
        self.callable_ = callable_
        self.dispatch = dispatch
        self.trackparent = trackparent
        self.parent_token = parent_token or self
        self.send_modified_events = send_modified_events
        if compare_function is None:
            self.is_equal = operator.eq
        else:
            self.is_equal = compare_function

        if accepts_scalar_loader is not None:
            self.accepts_scalar_loader = accepts_scalar_loader
        else:
            self.accepts_scalar_loader = self.default_accepts_scalar_loader

        _deferred_history = kwargs.pop("_deferred_history", False)
        self._deferred_history = _deferred_history

        if active_history:
            self.dispatch._active_history = True

        self.load_on_unexpire = load_on_unexpire
        self._modified_token = AttributeEventToken(self, OP_MODIFIED)

    __slots__ = (
        "class_",
        "key",
        "callable_",
        "dispatch",
        "trackparent",
        "parent_token",
        "send_modified_events",
        "is_equal",
        "load_on_unexpire",
        "_modified_token",
        "accepts_scalar_loader",
        "_deferred_history",
    )

    def __str__(self) -> str:
        return f"{self.class_.__name__}.{self.key}"

    def _get_active_history(self):
        """Backwards compat for impl.active_history"""

        return self.dispatch._active_history

    def _set_active_history(self, value):
        self.dispatch._active_history = value

    active_history = property(_get_active_history, _set_active_history)

    def hasparent(
        self, state: InstanceState[Any], optimistic: bool = False
    ) -> bool:
        """Return the boolean value of a `hasparent` flag attached to
        the given state.

        The `optimistic` flag determines what the default return value
        should be if no `hasparent` flag can be located.

        As this function is used to determine if an instance is an
        *orphan*, instances that were loaded from storage should be
        assumed to not be orphans, until a True/False value for this
        flag is set.

        An instance attribute that is loaded by a callable function
        will also not have a `hasparent` flag.

        """
        msg = "This AttributeImpl is not configured to track parents."
        assert self.trackparent, msg

        return (
            state.parents.get(id(self.parent_token), optimistic) is not False
        )

    def sethasparent(
        self,
        state: InstanceState[Any],
        parent_state: InstanceState[Any],
        value: bool,
    ) -> None:
        """Set a boolean flag on the given item corresponding to
        whether or not it is attached to a parent object via the
        attribute represented by this ``InstrumentedAttribute``.

        """
        msg = "This AttributeImpl is not configured to track parents."
        assert self.trackparent, msg

        id_ = id(self.parent_token)
        if value:
            state.parents[id_] = parent_state
        else:
            if id_ in state.parents:
                last_parent = state.parents[id_]

                if (
                    last_parent is not False
                    and last_parent.key != parent_state.key
                ):
                    if last_parent.obj() is None:
                        raise orm_exc.StaleDataError(
                            "Removing state %s from parent "
                            "state %s along attribute '%s', "
                            "but the parent record "
                            "has gone stale, can't be sure this "
                            "is the most recent parent."
                            % (
                                state_str(state),
                                state_str(parent_state),
                                self.key,
                            )
                        )

                    return

            state.parents[id_] = False

    def get_history(
        self,
        state: InstanceState[Any],
        dict_: _InstanceDict,
        passive: PassiveFlag = PASSIVE_OFF,
    ) -> History:
        raise NotImplementedError()

    def get_all_pending(
        self,
        state: InstanceState[Any],
        dict_: _InstanceDict,
        passive: PassiveFlag = PASSIVE_NO_INITIALIZE,
    ) -> _AllPendingType:
        """Return a list of tuples of (state, obj)
        for all objects in this attribute's current state
        + history.

        Only applies to object-based attributes.

        This is an inlining of existing functionality
        which roughly corresponds to:

            get_state_history(
                        state,
                        key,
                        passive=PASSIVE_NO_INITIALIZE).sum()

        """
        raise NotImplementedError()

    def _default_value(
        self, state: InstanceState[Any], dict_: _InstanceDict
    ) -> Any:
        """Produce an empty value for an uninitialized scalar attribute."""

        assert self.key not in dict_, (
            "_default_value should only be invoked for an "
            "uninitialized or expired attribute"
        )

        value = None
        for fn in self.dispatch.init_scalar:
            ret = fn(state, value, dict_)
            if ret is not ATTR_EMPTY:
                value = ret

        return value

    def get(
        self,
        state: InstanceState[Any],
        dict_: _InstanceDict,
        passive: PassiveFlag = PASSIVE_OFF,
    ) -> Any:
        """Retrieve a value from the given object.
        If a callable is assembled on this object's attribute, and
        passive is False, the callable will be executed and the
        resulting value will be set as the new value for this attribute.
        """
        if self.key in dict_:
            return dict_[self.key]
        else:
            # if history present, don't load
            key = self.key
            if (
                key not in state.committed_state
                or state.committed_state[key] is NO_VALUE
            ):
                if not passive & CALLABLES_OK:
                    return PASSIVE_NO_RESULT

                value = self._fire_loader_callables(state, key, passive)

                if value is PASSIVE_NO_RESULT or value is NO_VALUE:
                    return value
                elif value is ATTR_WAS_SET:
                    try:
                        return dict_[key]
                    except KeyError as err:
                        # TODO: no test coverage here.
                        raise KeyError(
                            "Deferred loader for attribute "
                            "%r failed to populate "
                            "correctly" % key
                        ) from err
                elif value is not ATTR_EMPTY:
                    return self.set_committed_value(state, dict_, value)

            if not passive & INIT_OK:
                return NO_VALUE
            else:
                return self._default_value(state, dict_)

    def _fire_loader_callables(
        self, state: InstanceState[Any], key: str, passive: PassiveFlag
    ) -> Any:
        if (
            self.accepts_scalar_loader
            and self.load_on_unexpire
            and key in state.expired_attributes
        ):
            return state._load_expired(state, passive)
        elif key in state.callables:
            callable_ = state.callables[key]
            return callable_(state, passive)
        elif self.callable_:
            return self.callable_(state, passive)
        else:
            return ATTR_EMPTY

    def append(
        self,
        state: InstanceState[Any],
        dict_: _InstanceDict,
        value: Any,
        initiator: Optional[AttributeEventToken],
        passive: PassiveFlag = PASSIVE_OFF,
    ) -> None:
        self.set(state, dict_, value, initiator, passive=passive)

    def remove(
        self,
        state: InstanceState[Any],
        dict_: _InstanceDict,
        value: Any,
        initiator: Optional[AttributeEventToken],
        passive: PassiveFlag = PASSIVE_OFF,
    ) -> None:
        self.set(
            state, dict_, None, initiator, passive=passive, check_old=value
        )

    def pop(
        self,
        state: InstanceState[Any],
        dict_: _InstanceDict,
        value: Any,
        initiator: Optional[AttributeEventToken],
        passive: PassiveFlag = PASSIVE_OFF,
    ) -> None:
        self.set(
            state,
            dict_,
            None,
            initiator,
            passive=passive,
            check_old=value,
            pop=True,
        )

    def set(
        self,
        state: InstanceState[Any],
        dict_: _InstanceDict,
        value: Any,
        initiator: Optional[AttributeEventToken] = None,
        passive: PassiveFlag = PASSIVE_OFF,
        check_old: Any = None,
        pop: bool = False,
    ) -> None:
        raise NotImplementedError()

    def delete(self, state: InstanceState[Any], dict_: _InstanceDict) -> None:
        raise NotImplementedError()

    def get_committed_value(
        self,
        state: InstanceState[Any],
        dict_: _InstanceDict,
        passive: PassiveFlag = PASSIVE_OFF,
    ) -> Any:
        """return the unchanged value of this attribute"""

        if self.key in state.committed_state:
            value = state.committed_state[self.key]
            if value is NO_VALUE:
                return None
            else:
                return value
        else:
            return self.get(state, dict_, passive=passive)

    def set_committed_value(self, state, dict_, value):
        """set an attribute value on the given instance and 'commit' it."""

        dict_[self.key] = value
        state._commit(dict_, [self.key])
        return value


class ScalarAttributeImpl(AttributeImpl):
    """represents a scalar value-holding InstrumentedAttribute."""

    default_accepts_scalar_loader = True
    uses_objects = False
    supports_population = True
    collection = False
    dynamic = False

    __slots__ = "_replace_token", "_append_token", "_remove_token"

    def __init__(self, *arg, **kw):
        super().__init__(*arg, **kw)
        self._replace_token = self._append_token = AttributeEventToken(
            self, OP_REPLACE
        )
        self._remove_token = AttributeEventToken(self, OP_REMOVE)

    def delete(self, state: InstanceState[Any], dict_: _InstanceDict) -> None:
        if self.dispatch._active_history:
            old = self.get(state, dict_, PASSIVE_RETURN_NO_VALUE)
        else:
            old = dict_.get(self.key, NO_VALUE)

        if self.dispatch.remove:
            self.fire_remove_event(state, dict_, old, self._remove_token)
        state._modified_event(dict_, self, old)

        existing = dict_.pop(self.key, NO_VALUE)
        if (
            existing is NO_VALUE
            and old is NO_VALUE
            and not state.expired
            and self.key not in state.expired_attributes
        ):
            raise AttributeError("%s object does not have a value" % self)

    def get_history(
        self,
        state: InstanceState[Any],
        dict_: Dict[str, Any],
        passive: PassiveFlag = PASSIVE_OFF,
    ) -> History:
        if self.key in dict_:
            return History.from_scalar_attribute(self, state, dict_[self.key])
        elif self.key in state.committed_state:
            return History.from_scalar_attribute(self, state, NO_VALUE)
        else:
            if passive & INIT_OK:
                passive ^= INIT_OK
            current = self.get(state, dict_, passive=passive)
            if current is PASSIVE_NO_RESULT:
                return HISTORY_BLANK
            else:
                return History.from_scalar_attribute(self, state, current)

    def set(
        self,
        state: InstanceState[Any],
        dict_: Dict[str, Any],
        value: Any,
        initiator: Optional[AttributeEventToken] = None,
        passive: PassiveFlag = PASSIVE_OFF,
        check_old: Optional[object] = None,
        pop: bool = False,
    ) -> None:
        if self.dispatch._active_history:
            old = self.get(state, dict_, PASSIVE_RETURN_NO_VALUE)
        else:
            old = dict_.get(self.key, NO_VALUE)

        if self.dispatch.set:
            value = self.fire_replace_event(
                state, dict_, value, old, initiator
            )
        state._modified_event(dict_, self, old)
        dict_[self.key] = value

    def fire_replace_event(
        self,
        state: InstanceState[Any],
        dict_: _InstanceDict,
        value: _T,
        previous: Any,
        initiator: Optional[AttributeEventToken],
    ) -> _T:
        for fn in self.dispatch.set:
            value = fn(
                state, value, previous, initiator or self._replace_token
            )
        return value

    def fire_remove_event(
        self,
        state: InstanceState[Any],
        dict_: _InstanceDict,
        value: Any,
        initiator: Optional[AttributeEventToken],
    ) -> None:
        for fn in self.dispatch.remove:
            fn(state, value, initiator or self._remove_token)


class ScalarObjectAttributeImpl(ScalarAttributeImpl):
    """represents a scalar-holding InstrumentedAttribute,
    where the target object is also instrumented.

    Adds events to delete/set operations.

    """

    default_accepts_scalar_loader = False
    uses_objects = True
    supports_population = True
    collection = False

    __slots__ = ()

    def delete(self, state: InstanceState[Any], dict_: _InstanceDict) -> None:
        if self.dispatch._active_history:
            old = self.get(
                state,
                dict_,
                passive=PASSIVE_ONLY_PERSISTENT
                | NO_AUTOFLUSH
                | LOAD_AGAINST_COMMITTED,
            )
        else:
            old = self.get(
                state,
                dict_,
                passive=PASSIVE_NO_FETCH ^ INIT_OK
                | LOAD_AGAINST_COMMITTED
                | NO_RAISE,
            )

        self.fire_remove_event(state, dict_, old, self._remove_token)

        existing = dict_.pop(self.key, NO_VALUE)

        # if the attribute is expired, we currently have no way to tell
        # that an object-attribute was expired vs. not loaded.   So
        # for this test, we look to see if the object has a DB identity.
        if (
            existing is NO_VALUE
            and old is not PASSIVE_NO_RESULT
            and state.key is None
        ):
            raise AttributeError("%s object does not have a value" % self)

    def get_history(
        self,
        state: InstanceState[Any],
        dict_: _InstanceDict,
        passive: PassiveFlag = PASSIVE_OFF,
    ) -> History:
        if self.key in dict_:
            current = dict_[self.key]
        else:
            if passive & INIT_OK:
                passive ^= INIT_OK
            current = self.get(state, dict_, passive=passive)
            if current is PASSIVE_NO_RESULT:
                return HISTORY_BLANK

        if not self._deferred_history:
            return History.from_object_attribute(self, state, current)
        else:
            original = state.committed_state.get(self.key, _NO_HISTORY)
            if original is PASSIVE_NO_RESULT:
                loader_passive = passive | (
                    PASSIVE_ONLY_PERSISTENT
                    | NO_AUTOFLUSH
                    | LOAD_AGAINST_COMMITTED
                    | NO_RAISE
                    | DEFERRED_HISTORY_LOAD
                )
                original = self._fire_loader_callables(
                    state, self.key, loader_passive
                )
            return History.from_object_attribute(
                self, state, current, original=original
            )

    def get_all_pending(
        self,
        state: InstanceState[Any],
        dict_: _InstanceDict,
        passive: PassiveFlag = PASSIVE_NO_INITIALIZE,
    ) -> _AllPendingType:
        if self.key in dict_:
            current = dict_[self.key]
        elif passive & CALLABLES_OK:
            current = self.get(state, dict_, passive=passive)
        else:
            return []

        ret: _AllPendingType

        # can't use __hash__(), can't use __eq__() here
        if (
            current is not None
            and current is not PASSIVE_NO_RESULT
            and current is not NO_VALUE
        ):
            ret = [(instance_state(current), current)]
        else:
            ret = [(None, None)]

        if self.key in state.committed_state:
            original = state.committed_state[self.key]
            if (
                original is not None
                and original is not PASSIVE_NO_RESULT
                and original is not NO_VALUE
                and original is not current
            ):
                ret.append((instance_state(original), original))
        return ret

    def set(
        self,
        state: InstanceState[Any],
        dict_: _InstanceDict,
        value: Any,
        initiator: Optional[AttributeEventToken] = None,
        passive: PassiveFlag = PASSIVE_OFF,
        check_old: Any = None,
        pop: bool = False,
    ) -> None:
        """Set a value on the given InstanceState."""

        if self.dispatch._active_history:
            old = self.get(
                state,
                dict_,
                passive=PASSIVE_ONLY_PERSISTENT
                | NO_AUTOFLUSH
                | LOAD_AGAINST_COMMITTED,
            )
        else:
            old = self.get(
                state,
                dict_,
                passive=PASSIVE_NO_FETCH ^ INIT_OK
                | LOAD_AGAINST_COMMITTED
                | NO_RAISE,
            )

        if (
            check_old is not None
            and old is not PASSIVE_NO_RESULT
            and check_old is not old
        ):
            if pop:
                return
            else:
                raise ValueError(
                    "Object %s not associated with %s on attribute '%s'"
                    % (instance_str(check_old), state_str(state), self.key)
                )

        value = self.fire_replace_event(state, dict_, value, old, initiator)
        dict_[self.key] = value

    def fire_remove_event(
        self,
        state: InstanceState[Any],
        dict_: _InstanceDict,
        value: Any,
        initiator: Optional[AttributeEventToken],
    ) -> None:
        if self.trackparent and value not in (
            None,
            PASSIVE_NO_RESULT,
            NO_VALUE,
        ):
            self.sethasparent(instance_state(value), state, False)

        for fn in self.dispatch.remove:
            fn(state, value, initiator or self._remove_token)

        state._modified_event(dict_, self, value)

    def fire_replace_event(
        self,
        state: InstanceState[Any],
        dict_: _InstanceDict,
        value: _T,
        previous: Any,
        initiator: Optional[AttributeEventToken],
    ) -> _T:
        if self.trackparent:
            if previous is not value and previous not in (
                None,
                PASSIVE_NO_RESULT,
                NO_VALUE,
            ):
                self.sethasparent(instance_state(previous), state, False)

        for fn in self.dispatch.set:
            value = fn(
                state, value, previous, initiator or self._replace_token
            )

        state._modified_event(dict_, self, previous)

        if self.trackparent:
            if value is not None:
                self.sethasparent(instance_state(value), state, True)

        return value


class HasCollectionAdapter:
    __slots__ = ()

    collection: bool
    _is_has_collection_adapter = True

    def _dispose_previous_collection(
        self,
        state: InstanceState[Any],
        collection: _AdaptedCollectionProtocol,
        adapter: CollectionAdapter,
        fire_event: bool,
    ) -> None:
        raise NotImplementedError()

    @overload
    def get_collection(
        self,
        state: InstanceState[Any],
        dict_: _InstanceDict,
        user_data: Literal[None] = ...,
        passive: Literal[PassiveFlag.PASSIVE_OFF] = ...,
    ) -> CollectionAdapter:
        ...

    @overload
    def get_collection(
        self,
        state: InstanceState[Any],
        dict_: _InstanceDict,
        user_data: _AdaptedCollectionProtocol = ...,
        passive: PassiveFlag = ...,
    ) -> CollectionAdapter:
        ...

    @overload
    def get_collection(
        self,
        state: InstanceState[Any],
        dict_: _InstanceDict,
        user_data: Optional[_AdaptedCollectionProtocol] = ...,
        passive: PassiveFlag = ...,
    ) -> Union[
        Literal[LoaderCallableStatus.PASSIVE_NO_RESULT], CollectionAdapter
    ]:
        ...

    def get_collection(
        self,
        state: InstanceState[Any],
        dict_: _InstanceDict,
        user_data: Optional[_AdaptedCollectionProtocol] = None,
        passive: PassiveFlag = PassiveFlag.PASSIVE_OFF,
    ) -> Union[
        Literal[LoaderCallableStatus.PASSIVE_NO_RESULT], CollectionAdapter
    ]:
        raise NotImplementedError()

    def set(
        self,
        state: InstanceState[Any],
        dict_: _InstanceDict,
        value: Any,
        initiator: Optional[AttributeEventToken] = None,
        passive: PassiveFlag = PassiveFlag.PASSIVE_OFF,
        check_old: Any = None,
        pop: bool = False,
        _adapt: bool = True,
    ) -> None:
        raise NotImplementedError()


if TYPE_CHECKING:

    def _is_collection_attribute_impl(
        impl: AttributeImpl,
    ) -> TypeGuard[CollectionAttributeImpl]:
        ...

else:
    _is_collection_attribute_impl = operator.attrgetter("collection")


class CollectionAttributeImpl(HasCollectionAdapter, AttributeImpl):
    """A collection-holding attribute that instruments changes in membership.

    Only handles collections of instrumented objects.

    InstrumentedCollectionAttribute holds an arbitrary, user-specified
    container object (defaulting to a list) and brokers access to the
    CollectionAdapter, a "view" onto that object that presents consistent bag
    semantics to the orm layer independent of the user data implementation.

    """

    uses_objects = True
    collection = True
    default_accepts_scalar_loader = False
    supports_population = True
    dynamic = False

    _bulk_replace_token: AttributeEventToken

    __slots__ = (
        "copy",
        "collection_factory",
        "_append_token",
        "_remove_token",
        "_bulk_replace_token",
        "_duck_typed_as",
    )

    def __init__(
        self,
        class_,
        key,
        callable_,
        dispatch,
        typecallable=None,
        trackparent=False,
        copy_function=None,
        compare_function=None,
        **kwargs,
    ):
        super().__init__(
            class_,
            key,
            callable_,
            dispatch,
            trackparent=trackparent,
            compare_function=compare_function,
            **kwargs,
        )

        if copy_function is None:
            copy_function = self.__copy
        self.copy = copy_function
        self.collection_factory = typecallable
        self._append_token = AttributeEventToken(self, OP_APPEND)
        self._remove_token = AttributeEventToken(self, OP_REMOVE)
        self._bulk_replace_token = AttributeEventToken(self, OP_BULK_REPLACE)
        self._duck_typed_as = util.duck_type_collection(
            self.collection_factory()
        )

        if getattr(self.collection_factory, "_sa_linker", None):

            @event.listens_for(self, "init_collection")
            def link(target, collection, collection_adapter):
                collection._sa_linker(collection_adapter)

            @event.listens_for(self, "dispose_collection")
            def unlink(target, collection, collection_adapter):
                collection._sa_linker(None)

    def __copy(self, item):
        return [y for y in collections.collection_adapter(item)]

    def get_history(
        self,
        state: InstanceState[Any],
        dict_: _InstanceDict,
        passive: PassiveFlag = PASSIVE_OFF,
    ) -> History:
        current = self.get(state, dict_, passive=passive)

        if current is PASSIVE_NO_RESULT:
            if (
                passive & PassiveFlag.INCLUDE_PENDING_MUTATIONS
                and self.key in state._pending_mutations
            ):
                pending = state._pending_mutations[self.key]
                return pending.merge_with_history(HISTORY_BLANK)
            else:
                return HISTORY_BLANK
        else:
            if passive & PassiveFlag.INCLUDE_PENDING_MUTATIONS:
                # this collection is loaded / present.  should not be any
                # pending mutations
                assert self.key not in state._pending_mutations

            return History.from_collection(self, state, current)

    def get_all_pending(
        self,
        state: InstanceState[Any],
        dict_: _InstanceDict,
        passive: PassiveFlag = PASSIVE_NO_INITIALIZE,
    ) -> _AllPendingType:
        # NOTE: passive is ignored here at the moment

        if self.key not in dict_:
            return []

        current = dict_[self.key]
        current = getattr(current, "_sa_adapter")

        if self.key in state.committed_state:
            original = state.committed_state[self.key]
            if original is not NO_VALUE:
                current_states = [
                    ((c is not None) and instance_state(c) or None, c)
                    for c in current
                ]
                original_states = [
                    ((c is not None) and instance_state(c) or None, c)
                    for c in original
                ]

                current_set = dict(current_states)
                original_set = dict(original_states)

                return (
                    [
                        (s, o)
                        for s, o in current_states
                        if s not in original_set
                    ]
                    + [(s, o) for s, o in current_states if s in original_set]
                    + [
                        (s, o)
                        for s, o in original_states
                        if s not in current_set
                    ]
                )

        return [(instance_state(o), o) for o in current]

    def fire_append_event(
        self,
        state: InstanceState[Any],
        dict_: _InstanceDict,
        value: _T,
        initiator: Optional[AttributeEventToken],
        key: Optional[Any],
    ) -> _T:
        for fn in self.dispatch.append:
            value = fn(state, value, initiator or self._append_token, key=key)

        state._modified_event(dict_, self, NO_VALUE, True)

        if self.trackparent and value is not None:
            self.sethasparent(instance_state(value), state, True)

        return value

    def fire_append_wo_mutation_event(
        self,
        state: InstanceState[Any],
        dict_: _InstanceDict,
        value: _T,
        initiator: Optional[AttributeEventToken],
        key: Optional[Any],
    ) -> _T:
        for fn in self.dispatch.append_wo_mutation:
            value = fn(state, value, initiator or self._append_token, key=key)

        return value

    def fire_pre_remove_event(
        self,
        state: InstanceState[Any],
        dict_: _InstanceDict,
        initiator: Optional[AttributeEventToken],
        key: Optional[Any],
    ) -> None:
        """A special event used for pop() operations.

        The "remove" event needs to have the item to be removed passed to
        it, which in the case of pop from a set, we don't have a way to access
        the item before the operation.   the event is used for all pop()
        operations (even though set.pop is the one where it is really needed).

        """
        state._modified_event(dict_, self, NO_VALUE, True)

    def fire_remove_event(
        self,
        state: InstanceState[Any],
        dict_: _InstanceDict,
        value: Any,
        initiator: Optional[AttributeEventToken],
        key: Optional[Any],
    ) -> None:
        if self.trackparent and value is not None:
            self.sethasparent(instance_state(value), state, False)

        for fn in self.dispatch.remove:
            fn(state, value, initiator or self._remove_token, key=key)

        state._modified_event(dict_, self, NO_VALUE, True)

    def delete(self, state: InstanceState[Any], dict_: _InstanceDict) -> None:
        if self.key not in dict_:
            return

        state._modified_event(dict_, self, NO_VALUE, True)

        collection = self.get_collection(state, state.dict)
        collection.clear_with_event()

        # key is always present because we checked above.  e.g.
        # del is a no-op if collection not present.
        del dict_[self.key]

    def _default_value(
        self, state: InstanceState[Any], dict_: _InstanceDict
    ) -> _AdaptedCollectionProtocol:
        """Produce an empty collection for an un-initialized attribute"""

        assert self.key not in dict_, (
            "_default_value should only be invoked for an "
            "uninitialized or expired attribute"
        )

        if self.key in state._empty_collections:
            return state._empty_collections[self.key]

        adapter, user_data = self._initialize_collection(state)
        adapter._set_empty(user_data)
        return user_data

    def _initialize_collection(
        self, state: InstanceState[Any]
    ) -> Tuple[CollectionAdapter, _AdaptedCollectionProtocol]:
        adapter, collection = state.manager.initialize_collection(
            self.key, state, self.collection_factory
        )

        self.dispatch.init_collection(state, collection, adapter)

        return adapter, collection

    def append(
        self,
        state: InstanceState[Any],
        dict_: _InstanceDict,
        value: Any,
        initiator: Optional[AttributeEventToken],
        passive: PassiveFlag = PASSIVE_OFF,
    ) -> None:
        collection = self.get_collection(
            state, dict_, user_data=None, passive=passive
        )
        if collection is PASSIVE_NO_RESULT:
            value = self.fire_append_event(
                state, dict_, value, initiator, key=NO_KEY
            )
            assert (
                self.key not in dict_
            ), "Collection was loaded during event handling."
            state._get_pending_mutation(self.key).append(value)
        else:
            if TYPE_CHECKING:
                assert isinstance(collection, CollectionAdapter)
            collection.append_with_event(value, initiator)

    def remove(
        self,
        state: InstanceState[Any],
        dict_: _InstanceDict,
        value: Any,
        initiator: Optional[AttributeEventToken],
        passive: PassiveFlag = PASSIVE_OFF,
    ) -> None:
        collection = self.get_collection(
            state, state.dict, user_data=None, passive=passive
        )
        if collection is PASSIVE_NO_RESULT:
            self.fire_remove_event(state, dict_, value, initiator, key=NO_KEY)
            assert (
                self.key not in dict_
            ), "Collection was loaded during event handling."
            state._get_pending_mutation(self.key).remove(value)
        else:
            if TYPE_CHECKING:
                assert isinstance(collection, CollectionAdapter)
            collection.remove_with_event(value, initiator)

    def pop(
        self,
        state: InstanceState[Any],
        dict_: _InstanceDict,
        value: Any,
        initiator: Optional[AttributeEventToken],
        passive: PassiveFlag = PASSIVE_OFF,
    ) -> None:
        try:
            # TODO: better solution here would be to add
            # a "popper" role to collections.py to complement
            # "remover".
            self.remove(state, dict_, value, initiator, passive=passive)
        except (ValueError, KeyError, IndexError):
            pass

    def set(
        self,
        state: InstanceState[Any],
        dict_: _InstanceDict,
        value: Any,
        initiator: Optional[AttributeEventToken] = None,
        passive: PassiveFlag = PassiveFlag.PASSIVE_OFF,
        check_old: Any = None,
        pop: bool = False,
        _adapt: bool = True,
    ) -> None:
        iterable = orig_iterable = value
        new_keys = None

        # pulling a new collection first so that an adaptation exception does
        # not trigger a lazy load of the old collection.
        new_collection, user_data = self._initialize_collection(state)
        if _adapt:
            if new_collection._converter is not None:
                iterable = new_collection._converter(iterable)
            else:
                setting_type = util.duck_type_collection(iterable)
                receiving_type = self._duck_typed_as

                if setting_type is not receiving_type:
                    given = (
                        iterable is None
                        and "None"
                        or iterable.__class__.__name__
                    )
                    wanted = self._duck_typed_as.__name__
                    raise TypeError(
                        "Incompatible collection type: %s is not %s-like"
                        % (given, wanted)
                    )

                # If the object is an adapted collection, return the (iterable)
                # adapter.
                if hasattr(iterable, "_sa_iterator"):
                    iterable = iterable._sa_iterator()
                elif setting_type is dict:
                    new_keys = list(iterable)
                    iterable = iterable.values()
                else:
                    iterable = iter(iterable)
        elif util.duck_type_collection(iterable) is dict:
            new_keys = list(value)

        new_values = list(iterable)

        evt = self._bulk_replace_token

        self.dispatch.bulk_replace(state, new_values, evt, keys=new_keys)

        # propagate NO_RAISE in passive through to the get() for the
        # existing object (ticket #8862)
        old = self.get(
            state,
            dict_,
            passive=PASSIVE_ONLY_PERSISTENT ^ (passive & PassiveFlag.NO_RAISE),
        )
        if old is PASSIVE_NO_RESULT:
            old = self._default_value(state, dict_)
        elif old is orig_iterable:
            # ignore re-assignment of the current collection, as happens
            # implicitly with in-place operators (foo.collection |= other)
            return

        # place a copy of "old" in state.committed_state
        state._modified_event(dict_, self, old, True)

        old_collection = old._sa_adapter

        dict_[self.key] = user_data

        collections.bulk_replace(
            new_values, old_collection, new_collection, initiator=evt
        )

        self._dispose_previous_collection(state, old, old_collection, True)

    def _dispose_previous_collection(
        self,
        state: InstanceState[Any],
        collection: _AdaptedCollectionProtocol,
        adapter: CollectionAdapter,
        fire_event: bool,
    ) -> None:
        del collection._sa_adapter

        # discarding old collection make sure it is not referenced in empty
        # collections.
        state._empty_collections.pop(self.key, None)
        if fire_event:
            self.dispatch.dispose_collection(state, collection, adapter)

    def _invalidate_collection(
        self, collection: _AdaptedCollectionProtocol
    ) -> None:
        adapter = getattr(collection, "_sa_adapter")
        adapter.invalidated = True

    def set_committed_value(
        self, state: InstanceState[Any], dict_: _InstanceDict, value: Any
    ) -> _AdaptedCollectionProtocol:
        """Set an attribute value on the given instance and 'commit' it."""

        collection, user_data = self._initialize_collection(state)

        if value:
            collection.append_multiple_without_event(value)

        state.dict[self.key] = user_data

        state._commit(dict_, [self.key])

        if self.key in state._pending_mutations:
            # pending items exist.  issue a modified event,
            # add/remove new items.
            state._modified_event(dict_, self, user_data, True)

            pending = state._pending_mutations.pop(self.key)
            added = pending.added_items
            removed = pending.deleted_items
            for item in added:
                collection.append_without_event(item)
            for item in removed:
                collection.remove_without_event(item)

        return user_data

    @overload
    def get_collection(
        self,
        state: InstanceState[Any],
        dict_: _InstanceDict,
        user_data: Literal[None] = ...,
        passive: Literal[PassiveFlag.PASSIVE_OFF] = ...,
    ) -> CollectionAdapter:
        ...

    @overload
    def get_collection(
        self,
        state: InstanceState[Any],
        dict_: _InstanceDict,
        user_data: _AdaptedCollectionProtocol = ...,
        passive: PassiveFlag = ...,
    ) -> CollectionAdapter:
        ...

    @overload
    def get_collection(
        self,
        state: InstanceState[Any],
        dict_: _InstanceDict,
        user_data: Optional[_AdaptedCollectionProtocol] = ...,
        passive: PassiveFlag = PASSIVE_OFF,
    ) -> Union[
        Literal[LoaderCallableStatus.PASSIVE_NO_RESULT], CollectionAdapter
    ]:
        ...

    def get_collection(
        self,
        state: InstanceState[Any],
        dict_: _InstanceDict,
        user_data: Optional[_AdaptedCollectionProtocol] = None,
        passive: PassiveFlag = PASSIVE_OFF,
    ) -> Union[
        Literal[LoaderCallableStatus.PASSIVE_NO_RESULT], CollectionAdapter
    ]:
        """Retrieve the CollectionAdapter associated with the given state.

        if user_data is None, retrieves it from the state using normal
        "get()" rules, which will fire lazy callables or return the "empty"
        collection value.

        """
        if user_data is None:
            fetch_user_data = self.get(state, dict_, passive=passive)
            if fetch_user_data is LoaderCallableStatus.PASSIVE_NO_RESULT:
                return fetch_user_data
            else:
                user_data = cast("_AdaptedCollectionProtocol", fetch_user_data)

        return user_data._sa_adapter


def backref_listeners(
    attribute: QueryableAttribute[Any], key: str, uselist: bool
) -> None:
    """Apply listeners to synchronize a two-way relationship."""

    # use easily recognizable names for stack traces.

    # in the sections marked "tokens to test for a recursive loop",
    # this is somewhat brittle and very performance-sensitive logic
    # that is specific to how we might arrive at each event.  a marker
    # that can target us directly to arguments being invoked against
    # the impl might be simpler, but could interfere with other systems.

    parent_token = attribute.impl.parent_token
    parent_impl = attribute.impl

    def _acceptable_key_err(child_state, initiator, child_impl):
        raise ValueError(
            "Bidirectional attribute conflict detected: "
            'Passing object %s to attribute "%s" '
            'triggers a modify event on attribute "%s" '
            'via the backref "%s".'
            % (
                state_str(child_state),
                initiator.parent_token,
                child_impl.parent_token,
                attribute.impl.parent_token,
            )
        )

    def emit_backref_from_scalar_set_event(
        state, child, oldchild, initiator, **kw
    ):
        if oldchild is child:
            return child
        if (
            oldchild is not None
            and oldchild is not PASSIVE_NO_RESULT
            and oldchild is not NO_VALUE
        ):
            # With lazy=None, there's no guarantee that the full collection is
            # present when updating via a backref.
            old_state, old_dict = (
                instance_state(oldchild),
                instance_dict(oldchild),
            )
            impl = old_state.manager[key].impl

            # tokens to test for a recursive loop.
            if not impl.collection and not impl.dynamic:
                check_recursive_token = impl._replace_token
            else:
                check_recursive_token = impl._remove_token

            if initiator is not check_recursive_token:
                impl.pop(
                    old_state,
                    old_dict,
                    state.obj(),
                    parent_impl._append_token,
                    passive=PASSIVE_NO_FETCH,
                )

        if child is not None:
            child_state, child_dict = (
                instance_state(child),
                instance_dict(child),
            )
            child_impl = child_state.manager[key].impl

            if (
                initiator.parent_token is not parent_token
                and initiator.parent_token is not child_impl.parent_token
            ):
                _acceptable_key_err(state, initiator, child_impl)

            # tokens to test for a recursive loop.
            check_append_token = child_impl._append_token
            check_bulk_replace_token = (
                child_impl._bulk_replace_token
                if _is_collection_attribute_impl(child_impl)
                else None
            )

            if (
                initiator is not check_append_token
                and initiator is not check_bulk_replace_token
            ):
                child_impl.append(
                    child_state,
                    child_dict,
                    state.obj(),
                    initiator,
                    passive=PASSIVE_NO_FETCH,
                )
        return child

    def emit_backref_from_collection_append_event(
        state, child, initiator, **kw
    ):
        if child is None:
            return

        child_state, child_dict = instance_state(child), instance_dict(child)
        child_impl = child_state.manager[key].impl

        if (
            initiator.parent_token is not parent_token
            and initiator.parent_token is not child_impl.parent_token
        ):
            _acceptable_key_err(state, initiator, child_impl)

        # tokens to test for a recursive loop.
        check_append_token = child_impl._append_token
        check_bulk_replace_token = (
            child_impl._bulk_replace_token
            if _is_collection_attribute_impl(child_impl)
            else None
        )

        if (
            initiator is not check_append_token
            and initiator is not check_bulk_replace_token
        ):
            child_impl.append(
                child_state,
                child_dict,
                state.obj(),
                initiator,
                passive=PASSIVE_NO_FETCH,
            )
        return child

    def emit_backref_from_collection_remove_event(
        state, child, initiator, **kw
    ):
        if (
            child is not None
            and child is not PASSIVE_NO_RESULT
            and child is not NO_VALUE
        ):
            child_state, child_dict = (
                instance_state(child),
                instance_dict(child),
            )
            child_impl = child_state.manager[key].impl

            check_replace_token: Optional[AttributeEventToken]

            # tokens to test for a recursive loop.
            if not child_impl.collection and not child_impl.dynamic:
                check_remove_token = child_impl._remove_token
                check_replace_token = child_impl._replace_token
                check_for_dupes_on_remove = uselist and not parent_impl.dynamic
            else:
                check_remove_token = child_impl._remove_token
                check_replace_token = (
                    child_impl._bulk_replace_token
                    if _is_collection_attribute_impl(child_impl)
                    else None
                )
                check_for_dupes_on_remove = False

            if (
                initiator is not check_remove_token
                and initiator is not check_replace_token
            ):
                if not check_for_dupes_on_remove or not util.has_dupes(
                    # when this event is called, the item is usually
                    # present in the list, except for a pop() operation.
                    state.dict[parent_impl.key],
                    child,
                ):
                    child_impl.pop(
                        child_state,
                        child_dict,
                        state.obj(),
                        initiator,
                        passive=PASSIVE_NO_FETCH,
                    )

    if uselist:
        event.listen(
            attribute,
            "append",
            emit_backref_from_collection_append_event,
            retval=True,
            raw=True,
            include_key=True,
        )
    else:
        event.listen(
            attribute,
            "set",
            emit_backref_from_scalar_set_event,
            retval=True,
            raw=True,
            include_key=True,
        )
    # TODO: need coverage in test/orm/ of remove event
    event.listen(
        attribute,
        "remove",
        emit_backref_from_collection_remove_event,
        retval=True,
        raw=True,
        include_key=True,
    )


_NO_HISTORY = util.symbol("NO_HISTORY")
_NO_STATE_SYMBOLS = frozenset([id(PASSIVE_NO_RESULT), id(NO_VALUE)])


class History(NamedTuple):
    """A 3-tuple of added, unchanged and deleted values,
    representing the changes which have occurred on an instrumented
    attribute.

    The easiest way to get a :class:`.History` object for a particular
    attribute on an object is to use the :func:`_sa.inspect` function::

        from sqlalchemy import inspect

        hist = inspect(myobject).attrs.myattribute.history

    Each tuple member is an iterable sequence:

    * ``added`` - the collection of items added to the attribute (the first
      tuple element).

    * ``unchanged`` - the collection of items that have not changed on the
      attribute (the second tuple element).

    * ``deleted`` - the collection of items that have been removed from the
      attribute (the third tuple element).

    """

    added: Union[Tuple[()], List[Any]]
    unchanged: Union[Tuple[()], List[Any]]
    deleted: Union[Tuple[()], List[Any]]

    def __bool__(self) -> bool:
        return self != HISTORY_BLANK

    def empty(self) -> bool:
        """Return True if this :class:`.History` has no changes
        and no existing, unchanged state.

        """

        return not bool((self.added or self.deleted) or self.unchanged)

    def sum(self) -> Sequence[Any]:
        """Return a collection of added + unchanged + deleted."""

        return (
            (self.added or []) + (self.unchanged or []) + (self.deleted or [])
        )

    def non_deleted(self) -> Sequence[Any]:
        """Return a collection of added + unchanged."""

        return (self.added or []) + (self.unchanged or [])

    def non_added(self) -> Sequence[Any]:
        """Return a collection of unchanged + deleted."""

        return (self.unchanged or []) + (self.deleted or [])

    def has_changes(self) -> bool:
        """Return True if this :class:`.History` has changes."""

        return bool(self.added or self.deleted)

    def _merge(self, added: Iterable[Any], deleted: Iterable[Any]) -> History:
        return History(
            list(self.added) + list(added),
            self.unchanged,
            list(self.deleted) + list(deleted),
        )

    def as_state(self) -> History:
        return History(
            [
                (c is not None) and instance_state(c) or None
                for c in self.added
            ],
            [
                (c is not None) and instance_state(c) or None
                for c in self.unchanged
            ],
            [
                (c is not None) and instance_state(c) or None
                for c in self.deleted
            ],
        )

    @classmethod
    def from_scalar_attribute(
        cls,
        attribute: ScalarAttributeImpl,
        state: InstanceState[Any],
        current: Any,
    ) -> History:
        original = state.committed_state.get(attribute.key, _NO_HISTORY)

        deleted: Union[Tuple[()], List[Any]]

        if original is _NO_HISTORY:
            if current is NO_VALUE:
                return cls((), (), ())
            else:
                return cls((), [current], ())
        # don't let ClauseElement expressions here trip things up
        elif (
            current is not NO_VALUE
            and attribute.is_equal(current, original) is True
        ):
            return cls((), [current], ())
        else:
            # current convention on native scalars is to not
            # include information
            # about missing previous value in "deleted", but
            # we do include None, which helps in some primary
            # key situations
            if id(original) in _NO_STATE_SYMBOLS:
                deleted = ()
                # indicate a "del" operation occurred when we don't have
                # the previous value as: ([None], (), ())
                if id(current) in _NO_STATE_SYMBOLS:
                    current = None
            else:
                deleted = [original]
            if current is NO_VALUE:
                return cls((), (), deleted)
            else:
                return cls([current], (), deleted)

    @classmethod
    def from_object_attribute(
        cls,
        attribute: ScalarObjectAttributeImpl,
        state: InstanceState[Any],
        current: Any,
        original: Any = _NO_HISTORY,
    ) -> History:
        deleted: Union[Tuple[()], List[Any]]

        if original is _NO_HISTORY:
            original = state.committed_state.get(attribute.key, _NO_HISTORY)

        if original is _NO_HISTORY:
            if current is NO_VALUE:
                return cls((), (), ())
            else:
                return cls((), [current], ())
        elif current is original and current is not NO_VALUE:
            return cls((), [current], ())
        else:
            # current convention on related objects is to not
            # include information
            # about missing previous value in "deleted", and
            # to also not include None - the dependency.py rules
            # ignore the None in any case.
            if id(original) in _NO_STATE_SYMBOLS or original is None:
                deleted = ()
                # indicate a "del" operation occurred when we don't have
                # the previous value as: ([None], (), ())
                if id(current) in _NO_STATE_SYMBOLS:
                    current = None
            else:
                deleted = [original]
            if current is NO_VALUE:
                return cls((), (), deleted)
            else:
                return cls([current], (), deleted)

    @classmethod
    def from_collection(
        cls,
        attribute: CollectionAttributeImpl,
        state: InstanceState[Any],
        current: Any,
    ) -> History:
        original = state.committed_state.get(attribute.key, _NO_HISTORY)
        if current is NO_VALUE:
            return cls((), (), ())

        current = getattr(current, "_sa_adapter")
        if original is NO_VALUE:
            return cls(list(current), (), ())
        elif original is _NO_HISTORY:
            return cls((), list(current), ())
        else:
            current_states = [
                ((c is not None) and instance_state(c) or None, c)
                for c in current
            ]
            original_states = [
                ((c is not None) and instance_state(c) or None, c)
                for c in original
            ]

            current_set = dict(current_states)
            original_set = dict(original_states)

            return cls(
                [o for s, o in current_states if s not in original_set],
                [o for s, o in current_states if s in original_set],
                [o for s, o in original_states if s not in current_set],
            )


HISTORY_BLANK = History((), (), ())


def get_history(
    obj: object, key: str, passive: PassiveFlag = PASSIVE_OFF
) -> History:
    """Return a :class:`.History` record for the given object
    and attribute key.

    This is the **pre-flush** history for a given attribute, which is
    reset each time the :class:`.Session` flushes changes to the
    current database transaction.

    .. note::

        Prefer to use the :attr:`.AttributeState.history` and
        :meth:`.AttributeState.load_history` accessors to retrieve the
        :class:`.History` for instance attributes.


    :param obj: an object whose class is instrumented by the
      attributes package.

    :param key: string attribute name.

    :param passive: indicates loading behavior for the attribute
       if the value is not already present.   This is a
       bitflag attribute, which defaults to the symbol
       :attr:`.PASSIVE_OFF` indicating all necessary SQL
       should be emitted.

    .. seealso::

        :attr:`.AttributeState.history`

        :meth:`.AttributeState.load_history` - retrieve history
        using loader callables if the value is not locally present.

    """

    return get_state_history(instance_state(obj), key, passive)


def get_state_history(
    state: InstanceState[Any], key: str, passive: PassiveFlag = PASSIVE_OFF
) -> History:
    return state.get_history(key, passive)


def has_parent(
    cls: Type[_O], obj: _O, key: str, optimistic: bool = False
) -> bool:
    """TODO"""
    manager = manager_of_class(cls)
    state = instance_state(obj)
    return manager.has_parent(state, key, optimistic)


def register_attribute(
    class_: Type[_O],
    key: str,
    *,
    comparator: interfaces.PropComparator[_T],
    parententity: _InternalEntityType[_O],
    doc: Optional[str] = None,
    **kw: Any,
) -> InstrumentedAttribute[_T]:
    desc = register_descriptor(
        class_, key, comparator=comparator, parententity=parententity, doc=doc
    )
    register_attribute_impl(class_, key, **kw)
    return desc


def register_attribute_impl(
    class_: Type[_O],
    key: str,
    uselist: bool = False,
    callable_: Optional[_LoaderCallable] = None,
    useobject: bool = False,
    impl_class: Optional[Type[AttributeImpl]] = None,
    backref: Optional[str] = None,
    **kw: Any,
) -> QueryableAttribute[Any]:
    manager = manager_of_class(class_)
    if uselist:
        factory = kw.pop("typecallable", None)
        typecallable = manager.instrument_collection_class(
            key, factory or list
        )
    else:
        typecallable = kw.pop("typecallable", None)

    dispatch = cast(
        "_Dispatch[QueryableAttribute[Any]]", manager[key].dispatch
    )  # noqa: E501

    impl: AttributeImpl

    if impl_class:
        # TODO: this appears to be the WriteOnlyAttributeImpl /
        # DynamicAttributeImpl constructor which is hardcoded
        impl = cast("Type[WriteOnlyAttributeImpl]", impl_class)(
            class_, key, dispatch, **kw
        )
    elif uselist:
        impl = CollectionAttributeImpl(
            class_, key, callable_, dispatch, typecallable=typecallable, **kw
        )
    elif useobject:
        impl = ScalarObjectAttributeImpl(
            class_, key, callable_, dispatch, **kw
        )
    else:
        impl = ScalarAttributeImpl(class_, key, callable_, dispatch, **kw)

    manager[key].impl = impl

    if backref:
        backref_listeners(manager[key], backref, uselist)

    manager.post_configure_attribute(key)
    return manager[key]


def register_descriptor(
    class_: Type[Any],
    key: str,
    *,
    comparator: interfaces.PropComparator[_T],
    parententity: _InternalEntityType[Any],
    doc: Optional[str] = None,
) -> InstrumentedAttribute[_T]:
    manager = manager_of_class(class_)

    descriptor = InstrumentedAttribute(
        class_, key, comparator=comparator, parententity=parententity
    )

    descriptor.__doc__ = doc  # type: ignore

    manager.instrument_attribute(key, descriptor)
    return descriptor


def unregister_attribute(class_: Type[Any], key: str) -> None:
    manager_of_class(class_).uninstrument_attribute(key)


def init_collection(obj: object, key: str) -> CollectionAdapter:
    """Initialize a collection attribute and return the collection adapter.

    This function is used to provide direct access to collection internals
    for a previously unloaded attribute.  e.g.::

        collection_adapter = init_collection(someobject, 'elements')
        for elem in values:
            collection_adapter.append_without_event(elem)

    For an easier way to do the above, see
    :func:`~sqlalchemy.orm.attributes.set_committed_value`.

    :param obj: a mapped object

    :param key: string attribute name where the collection is located.

    """
    state = instance_state(obj)
    dict_ = state.dict
    return init_state_collection(state, dict_, key)


def init_state_collection(
    state: InstanceState[Any], dict_: _InstanceDict, key: str
) -> CollectionAdapter:
    """Initialize a collection attribute and return the collection adapter.

    Discards any existing collection which may be there.

    """
    attr = state.manager[key].impl

    if TYPE_CHECKING:
        assert isinstance(attr, HasCollectionAdapter)

    old = dict_.pop(key, None)  # discard old collection
    if old is not None:
        old_collection = old._sa_adapter
        attr._dispose_previous_collection(state, old, old_collection, False)

    user_data = attr._default_value(state, dict_)
    adapter: CollectionAdapter = attr.get_collection(
        state, dict_, user_data, passive=PassiveFlag.PASSIVE_NO_FETCH
    )
    adapter._reset_empty()

    return adapter


def set_committed_value(instance, key, value):
    """Set the value of an attribute with no history events.

    Cancels any previous history present.  The value should be
    a scalar value for scalar-holding attributes, or
    an iterable for any collection-holding attribute.

    This is the same underlying method used when a lazy loader
    fires off and loads additional data from the database.
    In particular, this method can be used by application code
    which has loaded additional attributes or collections through
    separate queries, which can then be attached to an instance
    as though it were part of its original loaded state.

    """
    state, dict_ = instance_state(instance), instance_dict(instance)
    state.manager[key].impl.set_committed_value(state, dict_, value)


def set_attribute(
    instance: object,
    key: str,
    value: Any,
    initiator: Optional[AttributeEventToken] = None,
) -> None:
    """Set the value of an attribute, firing history events.

    This function may be used regardless of instrumentation
    applied directly to the class, i.e. no descriptors are required.
    Custom attribute management schemes will need to make usage
    of this method to establish attribute state as understood
    by SQLAlchemy.

    :param instance: the object that will be modified

    :param key: string name of the attribute

    :param value: value to assign

    :param initiator: an instance of :class:`.Event` that would have
     been propagated from a previous event listener.  This argument
     is used when the :func:`.set_attribute` function is being used within
     an existing event listening function where an :class:`.Event` object
     is being supplied; the object may be used to track the origin of the
     chain of events.

     .. versionadded:: 1.2.3

    """
    state, dict_ = instance_state(instance), instance_dict(instance)
    state.manager[key].impl.set(state, dict_, value, initiator)


def get_attribute(instance: object, key: str) -> Any:
    """Get the value of an attribute, firing any callables required.

    This function may be used regardless of instrumentation
    applied directly to the class, i.e. no descriptors are required.
    Custom attribute management schemes will need to make usage
    of this method to make usage of attribute state as understood
    by SQLAlchemy.

    """
    state, dict_ = instance_state(instance), instance_dict(instance)
    return state.manager[key].impl.get(state, dict_)


def del_attribute(instance: object, key: str) -> None:
    """Delete the value of an attribute, firing history events.

    This function may be used regardless of instrumentation
    applied directly to the class, i.e. no descriptors are required.
    Custom attribute management schemes will need to make usage
    of this method to establish attribute state as understood
    by SQLAlchemy.

    """
    state, dict_ = instance_state(instance), instance_dict(instance)
    state.manager[key].impl.delete(state, dict_)


def flag_modified(instance: object, key: str) -> None:
    """Mark an attribute on an instance as 'modified'.

    This sets the 'modified' flag on the instance and
    establishes an unconditional change event for the given attribute.
    The attribute must have a value present, else an
    :class:`.InvalidRequestError` is raised.

    To mark an object "dirty" without referring to any specific attribute
    so that it is considered within a flush, use the
    :func:`.attributes.flag_dirty` call.

    .. seealso::

        :func:`.attributes.flag_dirty`

    """
    state, dict_ = instance_state(instance), instance_dict(instance)
    impl = state.manager[key].impl
    impl.dispatch.modified(state, impl._modified_token)
    state._modified_event(dict_, impl, NO_VALUE, is_userland=True)


def flag_dirty(instance: object) -> None:
    """Mark an instance as 'dirty' without any specific attribute mentioned.

    This is a special operation that will allow the object to travel through
    the flush process for interception by events such as
    :meth:`.SessionEvents.before_flush`.   Note that no SQL will be emitted in
    the flush process for an object that has no changes, even if marked dirty
    via this method.  However, a :meth:`.SessionEvents.before_flush` handler
    will be able to see the object in the :attr:`.Session.dirty` collection and
    may establish changes on it, which will then be included in the SQL
    emitted.

    .. versionadded:: 1.2

    .. seealso::

        :func:`.attributes.flag_modified`

    """

    state, dict_ = instance_state(instance), instance_dict(instance)
    state._modified_event(dict_, None, NO_VALUE, is_userland=True)
