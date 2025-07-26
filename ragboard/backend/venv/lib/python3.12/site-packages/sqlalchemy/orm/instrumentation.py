# orm/instrumentation.py
# Copyright (C) 2005-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php
# mypy: allow-untyped-defs, allow-untyped-calls

"""Defines SQLAlchemy's system of class instrumentation.

This module is usually not directly visible to user applications, but
defines a large part of the ORM's interactivity.

instrumentation.py deals with registration of end-user classes
for state tracking.   It interacts closely with state.py
and attributes.py which establish per-instance and per-class-attribute
instrumentation, respectively.

The class instrumentation system can be customized on a per-class
or global basis using the :mod:`sqlalchemy.ext.instrumentation`
module, which provides the means to build and specify
alternate instrumentation forms.

.. versionchanged: 0.8
   The instrumentation extension system was moved out of the
   ORM and into the external :mod:`sqlalchemy.ext.instrumentation`
   package.  When that package is imported, it installs
   itself within sqlalchemy.orm so that its more comprehensive
   resolution mechanics take effect.

"""


from __future__ import annotations

from typing import Any
from typing import Callable
from typing import cast
from typing import Collection
from typing import Dict
from typing import Generic
from typing import Iterable
from typing import List
from typing import Optional
from typing import Set
from typing import Tuple
from typing import Type
from typing import TYPE_CHECKING
from typing import TypeVar
from typing import Union
import weakref

from . import base
from . import collections
from . import exc
from . import interfaces
from . import state
from ._typing import _O
from .attributes import _is_collection_attribute_impl
from .. import util
from ..event import EventTarget
from ..util import HasMemoized
from ..util.typing import Literal
from ..util.typing import Protocol

if TYPE_CHECKING:
    from ._typing import _RegistryType
    from .attributes import AttributeImpl
    from .attributes import QueryableAttribute
    from .collections import _AdaptedCollectionProtocol
    from .collections import _CollectionFactoryType
    from .decl_base import _MapperConfig
    from .events import InstanceEvents
    from .mapper import Mapper
    from .state import InstanceState
    from ..event import dispatcher

_T = TypeVar("_T", bound=Any)
DEL_ATTR = util.symbol("DEL_ATTR")


class _ExpiredAttributeLoaderProto(Protocol):
    def __call__(
        self,
        state: state.InstanceState[Any],
        toload: Set[str],
        passive: base.PassiveFlag,
    ) -> None:
        ...


class _ManagerFactory(Protocol):
    def __call__(self, class_: Type[_O]) -> ClassManager[_O]:
        ...


class ClassManager(
    HasMemoized,
    Dict[str, "QueryableAttribute[Any]"],
    Generic[_O],
    EventTarget,
):
    """Tracks state information at the class level."""

    dispatch: dispatcher[ClassManager[_O]]

    MANAGER_ATTR = base.DEFAULT_MANAGER_ATTR
    STATE_ATTR = base.DEFAULT_STATE_ATTR

    _state_setter = staticmethod(util.attrsetter(STATE_ATTR))

    expired_attribute_loader: _ExpiredAttributeLoaderProto
    "previously known as deferred_scalar_loader"

    init_method: Optional[Callable[..., None]]
    original_init: Optional[Callable[..., None]] = None

    factory: Optional[_ManagerFactory]

    declarative_scan: Optional[weakref.ref[_MapperConfig]] = None

    registry: _RegistryType

    if not TYPE_CHECKING:
        # starts as None during setup
        registry = None

    class_: Type[_O]

    _bases: List[ClassManager[Any]]

    @property
    @util.deprecated(
        "1.4",
        message="The ClassManager.deferred_scalar_loader attribute is now "
        "named expired_attribute_loader",
    )
    def deferred_scalar_loader(self):
        return self.expired_attribute_loader

    @deferred_scalar_loader.setter
    @util.deprecated(
        "1.4",
        message="The ClassManager.deferred_scalar_loader attribute is now "
        "named expired_attribute_loader",
    )
    def deferred_scalar_loader(self, obj):
        self.expired_attribute_loader = obj

    def __init__(self, class_):
        self.class_ = class_
        self.info = {}
        self.new_init = None
        self.local_attrs = {}
        self.originals = {}
        self._finalized = False
        self.factory = None
        self.init_method = None

        self._bases = [
            mgr
            for mgr in cast(
                "List[Optional[ClassManager[Any]]]",
                [
                    opt_manager_of_class(base)
                    for base in self.class_.__bases__
                    if isinstance(base, type)
                ],
            )
            if mgr is not None
        ]

        for base_ in self._bases:
            self.update(base_)

        cast(
            "InstanceEvents", self.dispatch._events
        )._new_classmanager_instance(class_, self)

        for basecls in class_.__mro__:
            mgr = opt_manager_of_class(basecls)
            if mgr is not None:
                self.dispatch._update(mgr.dispatch)

        self.manage()

        if "__del__" in class_.__dict__:
            util.warn(
                "__del__() method on class %s will "
                "cause unreachable cycles and memory leaks, "
                "as SQLAlchemy instrumentation often creates "
                "reference cycles.  Please remove this method." % class_
            )

    def _update_state(
        self,
        finalize: bool = False,
        mapper: Optional[Mapper[_O]] = None,
        registry: Optional[_RegistryType] = None,
        declarative_scan: Optional[_MapperConfig] = None,
        expired_attribute_loader: Optional[
            _ExpiredAttributeLoaderProto
        ] = None,
        init_method: Optional[Callable[..., None]] = None,
    ) -> None:
        if mapper:
            self.mapper = mapper  #
        if registry:
            registry._add_manager(self)
        if declarative_scan:
            self.declarative_scan = weakref.ref(declarative_scan)
        if expired_attribute_loader:
            self.expired_attribute_loader = expired_attribute_loader

        if init_method:
            assert not self._finalized, (
                "class is already instrumented, "
                "init_method %s can't be applied" % init_method
            )
            self.init_method = init_method

        if not self._finalized:
            self.original_init = (
                self.init_method
                if self.init_method is not None
                and self.class_.__init__ is object.__init__
                else self.class_.__init__
            )

        if finalize and not self._finalized:
            self._finalize()

    def _finalize(self) -> None:
        if self._finalized:
            return
        self._finalized = True

        self._instrument_init()

        _instrumentation_factory.dispatch.class_instrument(self.class_)

    def __hash__(self) -> int:  # type: ignore[override]
        return id(self)

    def __eq__(self, other: Any) -> bool:
        return other is self

    @property
    def is_mapped(self) -> bool:
        return "mapper" in self.__dict__

    @HasMemoized.memoized_attribute
    def _all_key_set(self):
        return frozenset(self)

    @HasMemoized.memoized_attribute
    def _collection_impl_keys(self):
        return frozenset(
            [attr.key for attr in self.values() if attr.impl.collection]
        )

    @HasMemoized.memoized_attribute
    def _scalar_loader_impls(self):
        return frozenset(
            [
                attr.impl
                for attr in self.values()
                if attr.impl.accepts_scalar_loader
            ]
        )

    @HasMemoized.memoized_attribute
    def _loader_impls(self):
        return frozenset([attr.impl for attr in self.values()])

    @util.memoized_property
    def mapper(self) -> Mapper[_O]:
        # raises unless self.mapper has been assigned
        raise exc.UnmappedClassError(self.class_)

    def _all_sqla_attributes(self, exclude=None):
        """return an iterator of all classbound attributes that are
        implement :class:`.InspectionAttr`.

        This includes :class:`.QueryableAttribute` as well as extension
        types such as :class:`.hybrid_property` and
        :class:`.AssociationProxy`.

        """

        found: Dict[str, Any] = {}

        # constraints:
        # 1. yield keys in cls.__dict__ order
        # 2. if a subclass has the same key as a superclass, include that
        #    key as part of the ordering of the superclass, because an
        #    overridden key is usually installed by the mapper which is going
        #    on a different ordering
        # 3. don't use getattr() as this fires off descriptors

        for supercls in self.class_.__mro__[0:-1]:
            inherits = supercls.__mro__[1]
            for key in supercls.__dict__:
                found.setdefault(key, supercls)
                if key in inherits.__dict__:
                    continue
                val = found[key].__dict__[key]
                if (
                    isinstance(val, interfaces.InspectionAttr)
                    and val.is_attribute
                ):
                    yield key, val

    def _get_class_attr_mro(self, key, default=None):
        """return an attribute on the class without tripping it."""

        for supercls in self.class_.__mro__:
            if key in supercls.__dict__:
                return supercls.__dict__[key]
        else:
            return default

    def _attr_has_impl(self, key: str) -> bool:
        """Return True if the given attribute is fully initialized.

        i.e. has an impl.
        """

        return key in self and self[key].impl is not None

    def _subclass_manager(self, cls: Type[_T]) -> ClassManager[_T]:
        """Create a new ClassManager for a subclass of this ClassManager's
        class.

        This is called automatically when attributes are instrumented so that
        the attributes can be propagated to subclasses against their own
        class-local manager, without the need for mappers etc. to have already
        pre-configured managers for the full class hierarchy.   Mappers
        can post-configure the auto-generated ClassManager when needed.

        """
        return register_class(cls, finalize=False)

    def _instrument_init(self):
        self.new_init = _generate_init(self.class_, self, self.original_init)
        self.install_member("__init__", self.new_init)

    @util.memoized_property
    def _state_constructor(self) -> Type[state.InstanceState[_O]]:
        self.dispatch.first_init(self, self.class_)
        return state.InstanceState

    def manage(self):
        """Mark this instance as the manager for its class."""

        setattr(self.class_, self.MANAGER_ATTR, self)

    @util.hybridmethod
    def manager_getter(self):
        return _default_manager_getter

    @util.hybridmethod
    def state_getter(self):
        """Return a (instance) -> InstanceState callable.

        "state getter" callables should raise either KeyError or
        AttributeError if no InstanceState could be found for the
        instance.
        """

        return _default_state_getter

    @util.hybridmethod
    def dict_getter(self):
        return _default_dict_getter

    def instrument_attribute(
        self,
        key: str,
        inst: QueryableAttribute[Any],
        propagated: bool = False,
    ) -> None:
        if propagated:
            if key in self.local_attrs:
                return  # don't override local attr with inherited attr
        else:
            self.local_attrs[key] = inst
            self.install_descriptor(key, inst)
        self._reset_memoizations()
        self[key] = inst

        for cls in self.class_.__subclasses__():
            manager = self._subclass_manager(cls)
            manager.instrument_attribute(key, inst, True)

    def subclass_managers(self, recursive):
        for cls in self.class_.__subclasses__():
            mgr = opt_manager_of_class(cls)
            if mgr is not None and mgr is not self:
                yield mgr
                if recursive:
                    yield from mgr.subclass_managers(True)

    def post_configure_attribute(self, key):
        _instrumentation_factory.dispatch.attribute_instrument(
            self.class_, key, self[key]
        )

    def uninstrument_attribute(self, key, propagated=False):
        if key not in self:
            return
        if propagated:
            if key in self.local_attrs:
                return  # don't get rid of local attr
        else:
            del self.local_attrs[key]
            self.uninstall_descriptor(key)
        self._reset_memoizations()
        del self[key]
        for cls in self.class_.__subclasses__():
            manager = opt_manager_of_class(cls)
            if manager:
                manager.uninstrument_attribute(key, True)

    def unregister(self) -> None:
        """remove all instrumentation established by this ClassManager."""

        for key in list(self.originals):
            self.uninstall_member(key)

        self.mapper = None
        self.dispatch = None  # type: ignore
        self.new_init = None
        self.info.clear()

        for key in list(self):
            if key in self.local_attrs:
                self.uninstrument_attribute(key)

        if self.MANAGER_ATTR in self.class_.__dict__:
            delattr(self.class_, self.MANAGER_ATTR)

    def install_descriptor(
        self, key: str, inst: QueryableAttribute[Any]
    ) -> None:
        if key in (self.STATE_ATTR, self.MANAGER_ATTR):
            raise KeyError(
                "%r: requested attribute name conflicts with "
                "instrumentation attribute of the same name." % key
            )
        setattr(self.class_, key, inst)

    def uninstall_descriptor(self, key: str) -> None:
        delattr(self.class_, key)

    def install_member(self, key: str, implementation: Any) -> None:
        if key in (self.STATE_ATTR, self.MANAGER_ATTR):
            raise KeyError(
                "%r: requested attribute name conflicts with "
                "instrumentation attribute of the same name." % key
            )
        self.originals.setdefault(key, self.class_.__dict__.get(key, DEL_ATTR))
        setattr(self.class_, key, implementation)

    def uninstall_member(self, key: str) -> None:
        original = self.originals.pop(key, None)
        if original is not DEL_ATTR:
            setattr(self.class_, key, original)
        else:
            delattr(self.class_, key)

    def instrument_collection_class(
        self, key: str, collection_class: Type[Collection[Any]]
    ) -> _CollectionFactoryType:
        return collections.prepare_instrumentation(collection_class)

    def initialize_collection(
        self,
        key: str,
        state: InstanceState[_O],
        factory: _CollectionFactoryType,
    ) -> Tuple[collections.CollectionAdapter, _AdaptedCollectionProtocol]:
        user_data = factory()
        impl = self.get_impl(key)
        assert _is_collection_attribute_impl(impl)
        adapter = collections.CollectionAdapter(impl, state, user_data)
        return adapter, user_data

    def is_instrumented(self, key: str, search: bool = False) -> bool:
        if search:
            return key in self
        else:
            return key in self.local_attrs

    def get_impl(self, key: str) -> AttributeImpl:
        return self[key].impl

    @property
    def attributes(self) -> Iterable[Any]:
        return iter(self.values())

    # InstanceState management

    def new_instance(self, state: Optional[InstanceState[_O]] = None) -> _O:
        # here, we would prefer _O to be bound to "object"
        # so that mypy sees that __new__ is present.   currently
        # it's bound to Any as there were other problems not having
        # it that way but these can be revisited
        instance = self.class_.__new__(self.class_)
        if state is None:
            state = self._state_constructor(instance, self)
        self._state_setter(instance, state)
        return instance

    def setup_instance(
        self, instance: _O, state: Optional[InstanceState[_O]] = None
    ) -> None:
        if state is None:
            state = self._state_constructor(instance, self)
        self._state_setter(instance, state)

    def teardown_instance(self, instance: _O) -> None:
        delattr(instance, self.STATE_ATTR)

    def _serialize(
        self, state: InstanceState[_O], state_dict: Dict[str, Any]
    ) -> _SerializeManager:
        return _SerializeManager(state, state_dict)

    def _new_state_if_none(
        self, instance: _O
    ) -> Union[Literal[False], InstanceState[_O]]:
        """Install a default InstanceState if none is present.

        A private convenience method used by the __init__ decorator.

        """
        if hasattr(instance, self.STATE_ATTR):
            return False
        elif self.class_ is not instance.__class__ and self.is_mapped:
            # this will create a new ClassManager for the
            # subclass, without a mapper.  This is likely a
            # user error situation but allow the object
            # to be constructed, so that it is usable
            # in a non-ORM context at least.
            return self._subclass_manager(
                instance.__class__
            )._new_state_if_none(instance)
        else:
            state = self._state_constructor(instance, self)
            self._state_setter(instance, state)
            return state

    def has_state(self, instance: _O) -> bool:
        return hasattr(instance, self.STATE_ATTR)

    def has_parent(
        self, state: InstanceState[_O], key: str, optimistic: bool = False
    ) -> bool:
        """TODO"""
        return self.get_impl(key).hasparent(state, optimistic=optimistic)

    def __bool__(self) -> bool:
        """All ClassManagers are non-zero regardless of attribute state."""
        return True

    def __repr__(self) -> str:
        return "<%s of %r at %x>" % (
            self.__class__.__name__,
            self.class_,
            id(self),
        )


class _SerializeManager:
    """Provide serialization of a :class:`.ClassManager`.

    The :class:`.InstanceState` uses ``__init__()`` on serialize
    and ``__call__()`` on deserialize.

    """

    def __init__(self, state: state.InstanceState[Any], d: Dict[str, Any]):
        self.class_ = state.class_
        manager = state.manager
        manager.dispatch.pickle(state, d)

    def __call__(self, state, inst, state_dict):
        state.manager = manager = opt_manager_of_class(self.class_)
        if manager is None:
            raise exc.UnmappedInstanceError(
                inst,
                "Cannot deserialize object of type %r - "
                "no mapper() has "
                "been configured for this class within the current "
                "Python process!" % self.class_,
            )
        elif manager.is_mapped and not manager.mapper.configured:
            manager.mapper._check_configure()

        # setup _sa_instance_state ahead of time so that
        # unpickle events can access the object normally.
        # see [ticket:2362]
        if inst is not None:
            manager.setup_instance(inst, state)
        manager.dispatch.unpickle(state, state_dict)


class InstrumentationFactory(EventTarget):
    """Factory for new ClassManager instances."""

    dispatch: dispatcher[InstrumentationFactory]

    def create_manager_for_cls(self, class_: Type[_O]) -> ClassManager[_O]:
        assert class_ is not None
        assert opt_manager_of_class(class_) is None

        # give a more complicated subclass
        # a chance to do what it wants here
        manager, factory = self._locate_extended_factory(class_)

        if factory is None:
            factory = ClassManager
            manager = ClassManager(class_)
        else:
            assert manager is not None

        self._check_conflicts(class_, factory)

        manager.factory = factory

        return manager

    def _locate_extended_factory(
        self, class_: Type[_O]
    ) -> Tuple[Optional[ClassManager[_O]], Optional[_ManagerFactory]]:
        """Overridden by a subclass to do an extended lookup."""
        return None, None

    def _check_conflicts(
        self, class_: Type[_O], factory: Callable[[Type[_O]], ClassManager[_O]]
    ) -> None:
        """Overridden by a subclass to test for conflicting factories."""

    def unregister(self, class_: Type[_O]) -> None:
        manager = manager_of_class(class_)
        manager.unregister()
        self.dispatch.class_uninstrument(class_)


# this attribute is replaced by sqlalchemy.ext.instrumentation
# when imported.
_instrumentation_factory = InstrumentationFactory()

# these attributes are replaced by sqlalchemy.ext.instrumentation
# when a non-standard InstrumentationManager class is first
# used to instrument a class.
instance_state = _default_state_getter = base.instance_state

instance_dict = _default_dict_getter = base.instance_dict

manager_of_class = _default_manager_getter = base.manager_of_class
opt_manager_of_class = _default_opt_manager_getter = base.opt_manager_of_class


def register_class(
    class_: Type[_O],
    finalize: bool = True,
    mapper: Optional[Mapper[_O]] = None,
    registry: Optional[_RegistryType] = None,
    declarative_scan: Optional[_MapperConfig] = None,
    expired_attribute_loader: Optional[_ExpiredAttributeLoaderProto] = None,
    init_method: Optional[Callable[..., None]] = None,
) -> ClassManager[_O]:
    """Register class instrumentation.

    Returns the existing or newly created class manager.

    """

    manager = opt_manager_of_class(class_)
    if manager is None:
        manager = _instrumentation_factory.create_manager_for_cls(class_)
    manager._update_state(
        mapper=mapper,
        registry=registry,
        declarative_scan=declarative_scan,
        expired_attribute_loader=expired_attribute_loader,
        init_method=init_method,
        finalize=finalize,
    )

    return manager


def unregister_class(class_):
    """Unregister class instrumentation."""

    _instrumentation_factory.unregister(class_)


def is_instrumented(instance, key):
    """Return True if the given attribute on the given instance is
    instrumented by the attributes package.

    This function may be used regardless of instrumentation
    applied directly to the class, i.e. no descriptors are required.

    """
    return manager_of_class(instance.__class__).is_instrumented(
        key, search=True
    )


def _generate_init(class_, class_manager, original_init):
    """Build an __init__ decorator that triggers ClassManager events."""

    # TODO: we should use the ClassManager's notion of the
    # original '__init__' method, once ClassManager is fixed
    # to always reference that.

    if original_init is None:
        original_init = class_.__init__

    # Go through some effort here and don't change the user's __init__
    # calling signature, including the unlikely case that it has
    # a return value.
    # FIXME: need to juggle local names to avoid constructor argument
    # clashes.
    func_body = """\
def __init__(%(apply_pos)s):
    new_state = class_manager._new_state_if_none(%(self_arg)s)
    if new_state:
        return new_state._initialize_instance(%(apply_kw)s)
    else:
        return original_init(%(apply_kw)s)
"""
    func_vars = util.format_argspec_init(original_init, grouped=False)
    func_text = func_body % func_vars

    func_defaults = getattr(original_init, "__defaults__", None)
    func_kw_defaults = getattr(original_init, "__kwdefaults__", None)

    env = locals().copy()
    env["__name__"] = __name__
    exec(func_text, env)
    __init__ = env["__init__"]
    __init__.__doc__ = original_init.__doc__
    __init__._sa_original_init = original_init

    if func_defaults:
        __init__.__defaults__ = func_defaults
    if func_kw_defaults:
        __init__.__kwdefaults__ = func_kw_defaults

    return __init__
