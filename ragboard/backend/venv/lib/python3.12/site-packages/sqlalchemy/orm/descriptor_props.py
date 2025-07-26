# orm/descriptor_props.py
# Copyright (C) 2005-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php

"""Descriptor properties are more "auxiliary" properties
that exist as configurational elements, but don't participate
as actively in the load/persist ORM loop.

"""
from __future__ import annotations

from dataclasses import is_dataclass
import inspect
import itertools
import operator
import typing
from typing import Any
from typing import Callable
from typing import Dict
from typing import List
from typing import NoReturn
from typing import Optional
from typing import Sequence
from typing import Tuple
from typing import Type
from typing import TYPE_CHECKING
from typing import TypeVar
from typing import Union
import weakref

from . import attributes
from . import util as orm_util
from .base import _DeclarativeMapped
from .base import LoaderCallableStatus
from .base import Mapped
from .base import PassiveFlag
from .base import SQLORMOperations
from .interfaces import _AttributeOptions
from .interfaces import _IntrospectsAnnotations
from .interfaces import _MapsColumns
from .interfaces import MapperProperty
from .interfaces import PropComparator
from .util import _none_set
from .util import de_stringify_annotation
from .. import event
from .. import exc as sa_exc
from .. import schema
from .. import sql
from .. import util
from ..sql import expression
from ..sql import operators
from ..sql.elements import BindParameter
from ..util.typing import is_fwd_ref
from ..util.typing import is_pep593
from ..util.typing import typing_get_args

if typing.TYPE_CHECKING:
    from ._typing import _InstanceDict
    from ._typing import _RegistryType
    from .attributes import History
    from .attributes import InstrumentedAttribute
    from .attributes import QueryableAttribute
    from .context import ORMCompileState
    from .decl_base import _ClassScanMapperConfig
    from .mapper import Mapper
    from .properties import ColumnProperty
    from .properties import MappedColumn
    from .state import InstanceState
    from ..engine.base import Connection
    from ..engine.row import Row
    from ..sql._typing import _DMLColumnArgument
    from ..sql._typing import _InfoType
    from ..sql.elements import ClauseList
    from ..sql.elements import ColumnElement
    from ..sql.operators import OperatorType
    from ..sql.schema import Column
    from ..sql.selectable import Select
    from ..util.typing import _AnnotationScanType
    from ..util.typing import CallableReference
    from ..util.typing import DescriptorReference
    from ..util.typing import RODescriptorReference

_T = TypeVar("_T", bound=Any)
_PT = TypeVar("_PT", bound=Any)


class DescriptorProperty(MapperProperty[_T]):
    """:class:`.MapperProperty` which proxies access to a
    user-defined descriptor."""

    doc: Optional[str] = None

    uses_objects = False
    _links_to_entity = False

    descriptor: DescriptorReference[Any]

    def get_history(
        self,
        state: InstanceState[Any],
        dict_: _InstanceDict,
        passive: PassiveFlag = PassiveFlag.PASSIVE_OFF,
    ) -> History:
        raise NotImplementedError()

    def instrument_class(self, mapper: Mapper[Any]) -> None:
        prop = self

        class _ProxyImpl(attributes.AttributeImpl):
            accepts_scalar_loader = False
            load_on_unexpire = True
            collection = False

            @property
            def uses_objects(self) -> bool:  # type: ignore
                return prop.uses_objects

            def __init__(self, key: str):
                self.key = key

            def get_history(
                self,
                state: InstanceState[Any],
                dict_: _InstanceDict,
                passive: PassiveFlag = PassiveFlag.PASSIVE_OFF,
            ) -> History:
                return prop.get_history(state, dict_, passive)

        if self.descriptor is None:
            desc = getattr(mapper.class_, self.key, None)
            if mapper._is_userland_descriptor(self.key, desc):
                self.descriptor = desc

        if self.descriptor is None:

            def fset(obj: Any, value: Any) -> None:
                setattr(obj, self.name, value)

            def fdel(obj: Any) -> None:
                delattr(obj, self.name)

            def fget(obj: Any) -> Any:
                return getattr(obj, self.name)

            self.descriptor = property(fget=fget, fset=fset, fdel=fdel)

        proxy_attr = attributes.create_proxied_attribute(self.descriptor)(
            self.parent.class_,
            self.key,
            self.descriptor,
            lambda: self._comparator_factory(mapper),
            doc=self.doc,
            original_property=self,
        )
        proxy_attr.impl = _ProxyImpl(self.key)
        mapper.class_manager.instrument_attribute(self.key, proxy_attr)


_CompositeAttrType = Union[
    str,
    "Column[_T]",
    "MappedColumn[_T]",
    "InstrumentedAttribute[_T]",
    "Mapped[_T]",
]


_CC = TypeVar("_CC", bound=Any)


_composite_getters: weakref.WeakKeyDictionary[
    Type[Any], Callable[[Any], Tuple[Any, ...]]
] = weakref.WeakKeyDictionary()


class CompositeProperty(
    _MapsColumns[_CC], _IntrospectsAnnotations, DescriptorProperty[_CC]
):
    """Defines a "composite" mapped attribute, representing a collection
    of columns as one attribute.

    :class:`.CompositeProperty` is constructed using the :func:`.composite`
    function.

    .. seealso::

        :ref:`mapper_composite`

    """

    composite_class: Union[Type[_CC], Callable[..., _CC]]
    attrs: Tuple[_CompositeAttrType[Any], ...]

    _generated_composite_accessor: CallableReference[
        Optional[Callable[[_CC], Tuple[Any, ...]]]
    ]

    comparator_factory: Type[Comparator[_CC]]

    def __init__(
        self,
        _class_or_attr: Union[
            None, Type[_CC], Callable[..., _CC], _CompositeAttrType[Any]
        ] = None,
        *attrs: _CompositeAttrType[Any],
        attribute_options: Optional[_AttributeOptions] = None,
        active_history: bool = False,
        deferred: bool = False,
        group: Optional[str] = None,
        comparator_factory: Optional[Type[Comparator[_CC]]] = None,
        info: Optional[_InfoType] = None,
        **kwargs: Any,
    ):
        super().__init__(attribute_options=attribute_options)

        if isinstance(_class_or_attr, (Mapped, str, sql.ColumnElement)):
            self.attrs = (_class_or_attr,) + attrs
            # will initialize within declarative_scan
            self.composite_class = None  # type: ignore
        else:
            self.composite_class = _class_or_attr  # type: ignore
            self.attrs = attrs

        self.active_history = active_history
        self.deferred = deferred
        self.group = group
        self.comparator_factory = (
            comparator_factory
            if comparator_factory is not None
            else self.__class__.Comparator
        )
        self._generated_composite_accessor = None
        if info is not None:
            self.info.update(info)

        util.set_creation_order(self)
        self._create_descriptor()
        self._init_accessor()

    def instrument_class(self, mapper: Mapper[Any]) -> None:
        super().instrument_class(mapper)
        self._setup_event_handlers()

    def _composite_values_from_instance(self, value: _CC) -> Tuple[Any, ...]:
        if self._generated_composite_accessor:
            return self._generated_composite_accessor(value)
        else:
            try:
                accessor = value.__composite_values__
            except AttributeError as ae:
                raise sa_exc.InvalidRequestError(
                    f"Composite class {self.composite_class.__name__} is not "
                    f"a dataclass and does not define a __composite_values__()"
                    " method; can't get state"
                ) from ae
            else:
                return accessor()  # type: ignore

    def do_init(self) -> None:
        """Initialization which occurs after the :class:`.Composite`
        has been associated with its parent mapper.

        """
        self._setup_arguments_on_columns()

    _COMPOSITE_FGET = object()

    def _create_descriptor(self) -> None:
        """Create the Python descriptor that will serve as
        the access point on instances of the mapped class.

        """

        def fget(instance: Any) -> Any:
            dict_ = attributes.instance_dict(instance)
            state = attributes.instance_state(instance)

            if self.key not in dict_:
                # key not present.  Iterate through related
                # attributes, retrieve their values.  This
                # ensures they all load.
                values = [
                    getattr(instance, key) for key in self._attribute_keys
                ]

                # current expected behavior here is that the composite is
                # created on access if the object is persistent or if
                # col attributes have non-None.  This would be better
                # if the composite were created unconditionally,
                # but that would be a behavioral change.
                if self.key not in dict_ and (
                    state.key is not None or not _none_set.issuperset(values)
                ):
                    dict_[self.key] = self.composite_class(*values)
                    state.manager.dispatch.refresh(
                        state, self._COMPOSITE_FGET, [self.key]
                    )

            return dict_.get(self.key, None)

        def fset(instance: Any, value: Any) -> None:
            dict_ = attributes.instance_dict(instance)
            state = attributes.instance_state(instance)
            attr = state.manager[self.key]

            if attr.dispatch._active_history:
                previous = fget(instance)
            else:
                previous = dict_.get(self.key, LoaderCallableStatus.NO_VALUE)

            for fn in attr.dispatch.set:
                value = fn(state, value, previous, attr.impl)
            dict_[self.key] = value
            if value is None:
                for key in self._attribute_keys:
                    setattr(instance, key, None)
            else:
                for key, value in zip(
                    self._attribute_keys,
                    self._composite_values_from_instance(value),
                ):
                    setattr(instance, key, value)

        def fdel(instance: Any) -> None:
            state = attributes.instance_state(instance)
            dict_ = attributes.instance_dict(instance)
            attr = state.manager[self.key]

            if attr.dispatch._active_history:
                previous = fget(instance)
                dict_.pop(self.key, None)
            else:
                previous = dict_.pop(self.key, LoaderCallableStatus.NO_VALUE)

            attr = state.manager[self.key]
            attr.dispatch.remove(state, previous, attr.impl)
            for key in self._attribute_keys:
                setattr(instance, key, None)

        self.descriptor = property(fget, fset, fdel)

    @util.preload_module("sqlalchemy.orm.properties")
    def declarative_scan(
        self,
        decl_scan: _ClassScanMapperConfig,
        registry: _RegistryType,
        cls: Type[Any],
        originating_module: Optional[str],
        key: str,
        mapped_container: Optional[Type[Mapped[Any]]],
        annotation: Optional[_AnnotationScanType],
        extracted_mapped_annotation: Optional[_AnnotationScanType],
        is_dataclass_field: bool,
    ) -> None:
        MappedColumn = util.preloaded.orm_properties.MappedColumn
        if (
            self.composite_class is None
            and extracted_mapped_annotation is None
        ):
            self._raise_for_required(key, cls)
        argument = extracted_mapped_annotation

        if is_pep593(argument):
            argument = typing_get_args(argument)[0]

        if argument and self.composite_class is None:
            if isinstance(argument, str) or is_fwd_ref(
                argument, check_generic=True
            ):
                if originating_module is None:
                    str_arg = (
                        argument.__forward_arg__
                        if hasattr(argument, "__forward_arg__")
                        else str(argument)
                    )
                    raise sa_exc.ArgumentError(
                        f"Can't use forward ref {argument} for composite "
                        f"class argument; set up the type as Mapped[{str_arg}]"
                    )
                argument = de_stringify_annotation(
                    cls, argument, originating_module, include_generic=True
                )

            self.composite_class = argument

        if is_dataclass(self.composite_class):
            self._setup_for_dataclass(registry, cls, originating_module, key)
        else:
            for attr in self.attrs:
                if (
                    isinstance(attr, (MappedColumn, schema.Column))
                    and attr.name is None
                ):
                    raise sa_exc.ArgumentError(
                        "Composite class column arguments must be named "
                        "unless a dataclass is used"
                    )
        self._init_accessor()

    def _init_accessor(self) -> None:
        if is_dataclass(self.composite_class) and not hasattr(
            self.composite_class, "__composite_values__"
        ):
            insp = inspect.signature(self.composite_class)
            getter = operator.attrgetter(
                *[p.name for p in insp.parameters.values()]
            )
            if len(insp.parameters) == 1:
                self._generated_composite_accessor = lambda obj: (getter(obj),)
            else:
                self._generated_composite_accessor = getter

        if (
            self.composite_class is not None
            and isinstance(self.composite_class, type)
            and self.composite_class not in _composite_getters
        ):
            if self._generated_composite_accessor is not None:
                _composite_getters[
                    self.composite_class
                ] = self._generated_composite_accessor
            elif hasattr(self.composite_class, "__composite_values__"):
                _composite_getters[
                    self.composite_class
                ] = lambda obj: obj.__composite_values__()

    @util.preload_module("sqlalchemy.orm.properties")
    @util.preload_module("sqlalchemy.orm.decl_base")
    def _setup_for_dataclass(
        self,
        registry: _RegistryType,
        cls: Type[Any],
        originating_module: Optional[str],
        key: str,
    ) -> None:
        MappedColumn = util.preloaded.orm_properties.MappedColumn

        decl_base = util.preloaded.orm_decl_base

        insp = inspect.signature(self.composite_class)
        for param, attr in itertools.zip_longest(
            insp.parameters.values(), self.attrs
        ):
            if param is None:
                raise sa_exc.ArgumentError(
                    f"number of composite attributes "
                    f"{len(self.attrs)} exceeds "
                    f"that of the number of attributes in class "
                    f"{self.composite_class.__name__} {len(insp.parameters)}"
                )
            if attr is None:
                # fill in missing attr spots with empty MappedColumn
                attr = MappedColumn()
                self.attrs += (attr,)

            if isinstance(attr, MappedColumn):
                attr.declarative_scan_for_composite(
                    registry,
                    cls,
                    originating_module,
                    key,
                    param.name,
                    param.annotation,
                )
            elif isinstance(attr, schema.Column):
                decl_base._undefer_column_name(param.name, attr)

    @util.memoized_property
    def _comparable_elements(self) -> Sequence[QueryableAttribute[Any]]:
        return [getattr(self.parent.class_, prop.key) for prop in self.props]

    @util.memoized_property
    @util.preload_module("orm.properties")
    def props(self) -> Sequence[MapperProperty[Any]]:
        props = []
        MappedColumn = util.preloaded.orm_properties.MappedColumn

        for attr in self.attrs:
            if isinstance(attr, str):
                prop = self.parent.get_property(attr, _configure_mappers=False)
            elif isinstance(attr, schema.Column):
                prop = self.parent._columntoproperty[attr]
            elif isinstance(attr, MappedColumn):
                prop = self.parent._columntoproperty[attr.column]
            elif isinstance(attr, attributes.InstrumentedAttribute):
                prop = attr.property
            else:
                prop = None

            if not isinstance(prop, MapperProperty):
                raise sa_exc.ArgumentError(
                    "Composite expects Column objects or mapped "
                    f"attributes/attribute names as arguments, got: {attr!r}"
                )

            props.append(prop)
        return props

    @util.non_memoized_property
    @util.preload_module("orm.properties")
    def columns(self) -> Sequence[Column[Any]]:
        MappedColumn = util.preloaded.orm_properties.MappedColumn
        return [
            a.column if isinstance(a, MappedColumn) else a
            for a in self.attrs
            if isinstance(a, (schema.Column, MappedColumn))
        ]

    @property
    def mapper_property_to_assign(self) -> Optional[MapperProperty[_CC]]:
        return self

    @property
    def columns_to_assign(self) -> List[Tuple[schema.Column[Any], int]]:
        return [(c, 0) for c in self.columns if c.table is None]

    @util.preload_module("orm.properties")
    def _setup_arguments_on_columns(self) -> None:
        """Propagate configuration arguments made on this composite
        to the target columns, for those that apply.

        """
        ColumnProperty = util.preloaded.orm_properties.ColumnProperty

        for prop in self.props:
            if not isinstance(prop, ColumnProperty):
                continue
            else:
                cprop = prop

            cprop.active_history = self.active_history
            if self.deferred:
                cprop.deferred = self.deferred
                cprop.strategy_key = (("deferred", True), ("instrument", True))
            cprop.group = self.group

    def _setup_event_handlers(self) -> None:
        """Establish events that populate/expire the composite attribute."""

        def load_handler(
            state: InstanceState[Any], context: ORMCompileState
        ) -> None:
            _load_refresh_handler(state, context, None, is_refresh=False)

        def refresh_handler(
            state: InstanceState[Any],
            context: ORMCompileState,
            to_load: Optional[Sequence[str]],
        ) -> None:
            # note this corresponds to sqlalchemy.ext.mutable load_attrs()

            if not to_load or (
                {self.key}.union(self._attribute_keys)
            ).intersection(to_load):
                _load_refresh_handler(state, context, to_load, is_refresh=True)

        def _load_refresh_handler(
            state: InstanceState[Any],
            context: ORMCompileState,
            to_load: Optional[Sequence[str]],
            is_refresh: bool,
        ) -> None:
            dict_ = state.dict

            # if context indicates we are coming from the
            # fget() handler, this already set the value; skip the
            # handler here. (other handlers like mutablecomposite will still
            # want to catch it)
            # there's an insufficiency here in that the fget() handler
            # really should not be using the refresh event and there should
            # be some other event that mutablecomposite can subscribe
            # towards for this.

            if (
                not is_refresh or context is self._COMPOSITE_FGET
            ) and self.key in dict_:
                return

            # if column elements aren't loaded, skip.
            # __get__() will initiate a load for those
            # columns
            for k in self._attribute_keys:
                if k not in dict_:
                    return

            dict_[self.key] = self.composite_class(
                *[state.dict[key] for key in self._attribute_keys]
            )

        def expire_handler(
            state: InstanceState[Any], keys: Optional[Sequence[str]]
        ) -> None:
            if keys is None or set(self._attribute_keys).intersection(keys):
                state.dict.pop(self.key, None)

        def insert_update_handler(
            mapper: Mapper[Any],
            connection: Connection,
            state: InstanceState[Any],
        ) -> None:
            """After an insert or update, some columns may be expired due
            to server side defaults, or re-populated due to client side
            defaults.  Pop out the composite value here so that it
            recreates.

            """

            state.dict.pop(self.key, None)

        event.listen(
            self.parent, "after_insert", insert_update_handler, raw=True
        )
        event.listen(
            self.parent, "after_update", insert_update_handler, raw=True
        )
        event.listen(
            self.parent, "load", load_handler, raw=True, propagate=True
        )
        event.listen(
            self.parent, "refresh", refresh_handler, raw=True, propagate=True
        )
        event.listen(
            self.parent, "expire", expire_handler, raw=True, propagate=True
        )

        proxy_attr = self.parent.class_manager[self.key]
        proxy_attr.impl.dispatch = proxy_attr.dispatch  # type: ignore
        proxy_attr.impl.dispatch._active_history = self.active_history

        # TODO: need a deserialize hook here

    @util.memoized_property
    def _attribute_keys(self) -> Sequence[str]:
        return [prop.key for prop in self.props]

    def _populate_composite_bulk_save_mappings_fn(
        self,
    ) -> Callable[[Dict[str, Any]], None]:
        if self._generated_composite_accessor:
            get_values = self._generated_composite_accessor
        else:

            def get_values(val: Any) -> Tuple[Any]:
                return val.__composite_values__()  # type: ignore

        attrs = [prop.key for prop in self.props]

        def populate(dest_dict: Dict[str, Any]) -> None:
            dest_dict.update(
                {
                    key: val
                    for key, val in zip(
                        attrs, get_values(dest_dict.pop(self.key))
                    )
                }
            )

        return populate

    def get_history(
        self,
        state: InstanceState[Any],
        dict_: _InstanceDict,
        passive: PassiveFlag = PassiveFlag.PASSIVE_OFF,
    ) -> History:
        """Provided for userland code that uses attributes.get_history()."""

        added: List[Any] = []
        deleted: List[Any] = []

        has_history = False
        for prop in self.props:
            key = prop.key
            hist = state.manager[key].impl.get_history(state, dict_)
            if hist.has_changes():
                has_history = True

            non_deleted = hist.non_deleted()
            if non_deleted:
                added.extend(non_deleted)
            else:
                added.append(None)
            if hist.deleted:
                deleted.extend(hist.deleted)
            else:
                deleted.append(None)

        if has_history:
            return attributes.History(
                [self.composite_class(*added)],
                (),
                [self.composite_class(*deleted)],
            )
        else:
            return attributes.History((), [self.composite_class(*added)], ())

    def _comparator_factory(
        self, mapper: Mapper[Any]
    ) -> Composite.Comparator[_CC]:
        return self.comparator_factory(self, mapper)

    class CompositeBundle(orm_util.Bundle[_T]):
        def __init__(
            self,
            property_: Composite[_T],
            expr: ClauseList,
        ):
            self.property = property_
            super().__init__(property_.key, *expr)

        def create_row_processor(
            self,
            query: Select[Any],
            procs: Sequence[Callable[[Row[Any]], Any]],
            labels: Sequence[str],
        ) -> Callable[[Row[Any]], Any]:
            def proc(row: Row[Any]) -> Any:
                return self.property.composite_class(
                    *[proc(row) for proc in procs]
                )

            return proc

    class Comparator(PropComparator[_PT]):
        """Produce boolean, comparison, and other operators for
        :class:`.Composite` attributes.

        See the example in :ref:`composite_operations` for an overview
        of usage , as well as the documentation for :class:`.PropComparator`.

        .. seealso::

            :class:`.PropComparator`

            :class:`.ColumnOperators`

            :ref:`types_operators`

            :attr:`.TypeEngine.comparator_factory`

        """

        # https://github.com/python/mypy/issues/4266
        __hash__ = None  # type: ignore

        prop: RODescriptorReference[Composite[_PT]]

        @util.memoized_property
        def clauses(self) -> ClauseList:
            return expression.ClauseList(
                group=False, *self._comparable_elements
            )

        def __clause_element__(self) -> CompositeProperty.CompositeBundle[_PT]:
            return self.expression

        @util.memoized_property
        def expression(self) -> CompositeProperty.CompositeBundle[_PT]:
            clauses = self.clauses._annotate(
                {
                    "parententity": self._parententity,
                    "parentmapper": self._parententity,
                    "proxy_key": self.prop.key,
                }
            )
            return CompositeProperty.CompositeBundle(self.prop, clauses)

        def _bulk_update_tuples(
            self, value: Any
        ) -> Sequence[Tuple[_DMLColumnArgument, Any]]:
            if isinstance(value, BindParameter):
                value = value.value

            values: Sequence[Any]

            if value is None:
                values = [None for key in self.prop._attribute_keys]
            elif isinstance(self.prop.composite_class, type) and isinstance(
                value, self.prop.composite_class
            ):
                values = self.prop._composite_values_from_instance(value)
            else:
                raise sa_exc.ArgumentError(
                    "Can't UPDATE composite attribute %s to %r"
                    % (self.prop, value)
                )

            return list(zip(self._comparable_elements, values))

        @util.memoized_property
        def _comparable_elements(self) -> Sequence[QueryableAttribute[Any]]:
            if self._adapt_to_entity:
                return [
                    getattr(self._adapt_to_entity.entity, prop.key)
                    for prop in self.prop._comparable_elements
                ]
            else:
                return self.prop._comparable_elements

        def __eq__(self, other: Any) -> ColumnElement[bool]:  # type: ignore[override]  # noqa: E501
            return self._compare(operators.eq, other)

        def __ne__(self, other: Any) -> ColumnElement[bool]:  # type: ignore[override]  # noqa: E501
            return self._compare(operators.ne, other)

        def __lt__(self, other: Any) -> ColumnElement[bool]:
            return self._compare(operators.lt, other)

        def __gt__(self, other: Any) -> ColumnElement[bool]:
            return self._compare(operators.gt, other)

        def __le__(self, other: Any) -> ColumnElement[bool]:
            return self._compare(operators.le, other)

        def __ge__(self, other: Any) -> ColumnElement[bool]:
            return self._compare(operators.ge, other)

        # what might be interesting would be if we create
        # an instance of the composite class itself with
        # the columns as data members, then use "hybrid style" comparison
        # to create these comparisons.  then your Point.__eq__() method could
        # be where comparison behavior is defined for SQL also.   Likely
        # not a good choice for default behavior though, not clear how it would
        # work w/ dataclasses, etc.  also no demand for any of this anyway.
        def _compare(
            self, operator: OperatorType, other: Any
        ) -> ColumnElement[bool]:
            values: Sequence[Any]
            if other is None:
                values = [None] * len(self.prop._comparable_elements)
            else:
                values = self.prop._composite_values_from_instance(other)
            comparisons = [
                operator(a, b)
                for a, b in zip(self.prop._comparable_elements, values)
            ]
            if self._adapt_to_entity:
                assert self.adapter is not None
                comparisons = [self.adapter(x) for x in comparisons]
            return sql.and_(*comparisons)

    def __str__(self) -> str:
        return str(self.parent.class_.__name__) + "." + self.key


class Composite(CompositeProperty[_T], _DeclarativeMapped[_T]):
    """Declarative-compatible front-end for the :class:`.CompositeProperty`
    class.

    Public constructor is the :func:`_orm.composite` function.

    .. versionchanged:: 2.0 Added :class:`_orm.Composite` as a Declarative
       compatible subclass of :class:`_orm.CompositeProperty`.

    .. seealso::

        :ref:`mapper_composite`

    """

    inherit_cache = True
    """:meta private:"""


class ConcreteInheritedProperty(DescriptorProperty[_T]):
    """A 'do nothing' :class:`.MapperProperty` that disables
    an attribute on a concrete subclass that is only present
    on the inherited mapper, not the concrete classes' mapper.

    Cases where this occurs include:

    * When the superclass mapper is mapped against a
      "polymorphic union", which includes all attributes from
      all subclasses.
    * When a relationship() is configured on an inherited mapper,
      but not on the subclass mapper.  Concrete mappers require
      that relationship() is configured explicitly on each
      subclass.

    """

    def _comparator_factory(
        self, mapper: Mapper[Any]
    ) -> Type[PropComparator[_T]]:
        comparator_callable = None

        for m in self.parent.iterate_to_root():
            p = m._props[self.key]
            if getattr(p, "comparator_factory", None) is not None:
                comparator_callable = p.comparator_factory
                break
        assert comparator_callable is not None
        return comparator_callable(p, mapper)  # type: ignore

    def __init__(self) -> None:
        super().__init__()

        def warn() -> NoReturn:
            raise AttributeError(
                "Concrete %s does not implement "
                "attribute %r at the instance level.  Add "
                "this property explicitly to %s."
                % (self.parent, self.key, self.parent)
            )

        class NoninheritedConcreteProp:
            def __set__(s: Any, obj: Any, value: Any) -> NoReturn:
                warn()

            def __delete__(s: Any, obj: Any) -> NoReturn:
                warn()

            def __get__(s: Any, obj: Any, owner: Any) -> Any:
                if obj is None:
                    return self.descriptor
                warn()

        self.descriptor = NoninheritedConcreteProp()


class SynonymProperty(DescriptorProperty[_T]):
    """Denote an attribute name as a synonym to a mapped property,
    in that the attribute will mirror the value and expression behavior
    of another attribute.

    :class:`.Synonym` is constructed using the :func:`_orm.synonym`
    function.

    .. seealso::

        :ref:`synonyms` - Overview of synonyms

    """

    comparator_factory: Optional[Type[PropComparator[_T]]]

    def __init__(
        self,
        name: str,
        map_column: Optional[bool] = None,
        descriptor: Optional[Any] = None,
        comparator_factory: Optional[Type[PropComparator[_T]]] = None,
        attribute_options: Optional[_AttributeOptions] = None,
        info: Optional[_InfoType] = None,
        doc: Optional[str] = None,
    ):
        super().__init__(attribute_options=attribute_options)

        self.name = name
        self.map_column = map_column
        self.descriptor = descriptor
        self.comparator_factory = comparator_factory
        if doc:
            self.doc = doc
        elif descriptor and descriptor.__doc__:
            self.doc = descriptor.__doc__
        else:
            self.doc = None
        if info:
            self.info.update(info)

        util.set_creation_order(self)

    if not TYPE_CHECKING:

        @property
        def uses_objects(self) -> bool:
            return getattr(self.parent.class_, self.name).impl.uses_objects

    # TODO: when initialized, check _proxied_object,
    # emit a warning if its not a column-based property

    @util.memoized_property
    def _proxied_object(
        self,
    ) -> Union[MapperProperty[_T], SQLORMOperations[_T]]:
        attr = getattr(self.parent.class_, self.name)
        if not hasattr(attr, "property") or not isinstance(
            attr.property, MapperProperty
        ):
            # attribute is a non-MapperProprerty proxy such as
            # hybrid or association proxy
            if isinstance(attr, attributes.QueryableAttribute):
                return attr.comparator
            elif isinstance(attr, SQLORMOperations):
                # assocaition proxy comes here
                return attr

            raise sa_exc.InvalidRequestError(
                """synonym() attribute "%s.%s" only supports """
                """ORM mapped attributes, got %r"""
                % (self.parent.class_.__name__, self.name, attr)
            )
        return attr.property

    def _comparator_factory(self, mapper: Mapper[Any]) -> SQLORMOperations[_T]:
        prop = self._proxied_object

        if isinstance(prop, MapperProperty):
            if self.comparator_factory:
                comp = self.comparator_factory(prop, mapper)
            else:
                comp = prop.comparator_factory(prop, mapper)
            return comp
        else:
            return prop

    def get_history(
        self,
        state: InstanceState[Any],
        dict_: _InstanceDict,
        passive: PassiveFlag = PassiveFlag.PASSIVE_OFF,
    ) -> History:
        attr: QueryableAttribute[Any] = getattr(self.parent.class_, self.name)
        return attr.impl.get_history(state, dict_, passive=passive)

    @util.preload_module("sqlalchemy.orm.properties")
    def set_parent(self, parent: Mapper[Any], init: bool) -> None:
        properties = util.preloaded.orm_properties

        if self.map_column:
            # implement the 'map_column' option.
            if self.key not in parent.persist_selectable.c:
                raise sa_exc.ArgumentError(
                    "Can't compile synonym '%s': no column on table "
                    "'%s' named '%s'"
                    % (
                        self.name,
                        parent.persist_selectable.description,
                        self.key,
                    )
                )
            elif (
                parent.persist_selectable.c[self.key]
                in parent._columntoproperty
                and parent._columntoproperty[
                    parent.persist_selectable.c[self.key]
                ].key
                == self.name
            ):
                raise sa_exc.ArgumentError(
                    "Can't call map_column=True for synonym %r=%r, "
                    "a ColumnProperty already exists keyed to the name "
                    "%r for column %r"
                    % (self.key, self.name, self.name, self.key)
                )
            p: ColumnProperty[Any] = properties.ColumnProperty(
                parent.persist_selectable.c[self.key]
            )
            parent._configure_property(self.name, p, init=init, setparent=True)
            p._mapped_by_synonym = self.key

        self.parent = parent


class Synonym(SynonymProperty[_T], _DeclarativeMapped[_T]):
    """Declarative front-end for the :class:`.SynonymProperty` class.

    Public constructor is the :func:`_orm.synonym` function.

    .. versionchanged:: 2.0 Added :class:`_orm.Synonym` as a Declarative
       compatible subclass for :class:`_orm.SynonymProperty`

    .. seealso::

        :ref:`synonyms` - Overview of synonyms

    """

    inherit_cache = True
    """:meta private:"""
