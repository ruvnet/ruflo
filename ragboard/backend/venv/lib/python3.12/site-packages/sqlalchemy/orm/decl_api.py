# orm/decl_api.py
# Copyright (C) 2005-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php

"""Public API functions and helpers for declarative."""

from __future__ import annotations

import itertools
import re
import typing
from typing import Any
from typing import Callable
from typing import cast
from typing import ClassVar
from typing import Dict
from typing import FrozenSet
from typing import Generic
from typing import Iterable
from typing import Iterator
from typing import Mapping
from typing import Optional
from typing import overload
from typing import Set
from typing import Tuple
from typing import Type
from typing import TYPE_CHECKING
from typing import TypeVar
from typing import Union
import weakref

from . import attributes
from . import clsregistry
from . import instrumentation
from . import interfaces
from . import mapperlib
from ._orm_constructors import composite
from ._orm_constructors import deferred
from ._orm_constructors import mapped_column
from ._orm_constructors import relationship
from ._orm_constructors import synonym
from .attributes import InstrumentedAttribute
from .base import _inspect_mapped_class
from .base import _is_mapped_class
from .base import Mapped
from .base import ORMDescriptor
from .decl_base import _add_attribute
from .decl_base import _as_declarative
from .decl_base import _ClassScanMapperConfig
from .decl_base import _declarative_constructor
from .decl_base import _DeferredMapperConfig
from .decl_base import _del_attribute
from .decl_base import _mapper
from .descriptor_props import Composite
from .descriptor_props import Synonym
from .descriptor_props import Synonym as _orm_synonym
from .mapper import Mapper
from .properties import MappedColumn
from .relationships import RelationshipProperty
from .state import InstanceState
from .. import exc
from .. import inspection
from .. import util
from ..sql import sqltypes
from ..sql.base import _NoArg
from ..sql.elements import SQLCoreOperations
from ..sql.schema import MetaData
from ..sql.selectable import FromClause
from ..util import hybridmethod
from ..util import hybridproperty
from ..util import typing as compat_typing
from ..util.typing import CallableReference
from ..util.typing import flatten_newtype
from ..util.typing import is_generic
from ..util.typing import is_literal
from ..util.typing import is_newtype
from ..util.typing import is_pep695
from ..util.typing import Literal
from ..util.typing import Self

if TYPE_CHECKING:
    from ._typing import _O
    from ._typing import _RegistryType
    from .decl_base import _DataclassArguments
    from .instrumentation import ClassManager
    from .interfaces import MapperProperty
    from .state import InstanceState  # noqa
    from ..sql._typing import _TypeEngineArgument
    from ..sql.type_api import _MatchedOnType

_T = TypeVar("_T", bound=Any)

_TT = TypeVar("_TT", bound=Any)

# it's not clear how to have Annotated, Union objects etc. as keys here
# from a typing perspective so just leave it open ended for now
_TypeAnnotationMapType = Mapping[Any, "_TypeEngineArgument[Any]"]
_MutableTypeAnnotationMapType = Dict[Any, "_TypeEngineArgument[Any]"]

_DeclaredAttrDecorated = Callable[
    ..., Union[Mapped[_T], ORMDescriptor[_T], SQLCoreOperations[_T]]
]


def has_inherited_table(cls: Type[_O]) -> bool:
    """Given a class, return True if any of the classes it inherits from has a
    mapped table, otherwise return False.

    This is used in declarative mixins to build attributes that behave
    differently for the base class vs. a subclass in an inheritance
    hierarchy.

    .. seealso::

        :ref:`decl_mixin_inheritance`

    """
    for class_ in cls.__mro__[1:]:
        if getattr(class_, "__table__", None) is not None:
            return True
    return False


class _DynamicAttributesType(type):
    def __setattr__(cls, key: str, value: Any) -> None:
        if "__mapper__" in cls.__dict__:
            _add_attribute(cls, key, value)
        else:
            type.__setattr__(cls, key, value)

    def __delattr__(cls, key: str) -> None:
        if "__mapper__" in cls.__dict__:
            _del_attribute(cls, key)
        else:
            type.__delattr__(cls, key)


class DeclarativeAttributeIntercept(
    _DynamicAttributesType,
    # Inspectable is used only by the mypy plugin
    inspection.Inspectable[Mapper[Any]],
):
    """Metaclass that may be used in conjunction with the
    :class:`_orm.DeclarativeBase` class to support addition of class
    attributes dynamically.

    """


@compat_typing.dataclass_transform(
    field_specifiers=(
        MappedColumn,
        RelationshipProperty,
        Composite,
        Synonym,
        mapped_column,
        relationship,
        composite,
        synonym,
        deferred,
    ),
)
class DCTransformDeclarative(DeclarativeAttributeIntercept):
    """metaclass that includes @dataclass_transforms"""


class DeclarativeMeta(DeclarativeAttributeIntercept):
    metadata: MetaData
    registry: RegistryType

    def __init__(
        cls, classname: Any, bases: Any, dict_: Any, **kw: Any
    ) -> None:
        # use cls.__dict__, which can be modified by an
        # __init_subclass__() method (#7900)
        dict_ = cls.__dict__

        # early-consume registry from the initial declarative base,
        # assign privately to not conflict with subclass attributes named
        # "registry"
        reg = getattr(cls, "_sa_registry", None)
        if reg is None:
            reg = dict_.get("registry", None)
            if not isinstance(reg, registry):
                raise exc.InvalidRequestError(
                    "Declarative base class has no 'registry' attribute, "
                    "or registry is not a sqlalchemy.orm.registry() object"
                )
            else:
                cls._sa_registry = reg

        if not cls.__dict__.get("__abstract__", False):
            _as_declarative(reg, cls, dict_)
        type.__init__(cls, classname, bases, dict_)


def synonym_for(
    name: str, map_column: bool = False
) -> Callable[[Callable[..., Any]], Synonym[Any]]:
    """Decorator that produces an :func:`_orm.synonym`
    attribute in conjunction with a Python descriptor.

    The function being decorated is passed to :func:`_orm.synonym` as the
    :paramref:`.orm.synonym.descriptor` parameter::

        class MyClass(Base):
            __tablename__ = 'my_table'

            id = Column(Integer, primary_key=True)
            _job_status = Column("job_status", String(50))

            @synonym_for("job_status")
            @property
            def job_status(self):
                return "Status: %s" % self._job_status

    The :ref:`hybrid properties <mapper_hybrids>` feature of SQLAlchemy
    is typically preferred instead of synonyms, which is a more legacy
    feature.

    .. seealso::

        :ref:`synonyms` - Overview of synonyms

        :func:`_orm.synonym` - the mapper-level function

        :ref:`mapper_hybrids` - The Hybrid Attribute extension provides an
        updated approach to augmenting attribute behavior more flexibly than
        can be achieved with synonyms.

    """

    def decorate(fn: Callable[..., Any]) -> Synonym[Any]:
        return _orm_synonym(name, map_column=map_column, descriptor=fn)

    return decorate


class _declared_attr_common:
    def __init__(
        self,
        fn: Callable[..., Any],
        cascading: bool = False,
        quiet: bool = False,
    ):
        # suppport
        # @declared_attr
        # @classmethod
        # def foo(cls) -> Mapped[thing]:
        #    ...
        # which seems to help typing tools interpret the fn as a classmethod
        # for situations where needed
        if isinstance(fn, classmethod):
            fn = fn.__func__

        self.fget = fn
        self._cascading = cascading
        self._quiet = quiet
        self.__doc__ = fn.__doc__

    def _collect_return_annotation(self) -> Optional[Type[Any]]:
        return util.get_annotations(self.fget).get("return")

    def __get__(self, instance: Optional[object], owner: Any) -> Any:
        # the declared_attr needs to make use of a cache that exists
        # for the span of the declarative scan_attributes() phase.
        # to achieve this we look at the class manager that's configured.

        # note this method should not be called outside of the declarative
        # setup phase

        cls = owner
        manager = attributes.opt_manager_of_class(cls)
        if manager is None:
            if not re.match(r"^__.+__$", self.fget.__name__):
                # if there is no manager at all, then this class hasn't been
                # run through declarative or mapper() at all, emit a warning.
                util.warn(
                    "Unmanaged access of declarative attribute %s from "
                    "non-mapped class %s" % (self.fget.__name__, cls.__name__)
                )
            return self.fget(cls)
        elif manager.is_mapped:
            # the class is mapped, which means we're outside of the declarative
            # scan setup, just run the function.
            return self.fget(cls)

        # here, we are inside of the declarative scan.  use the registry
        # that is tracking the values of these attributes.
        declarative_scan = manager.declarative_scan()

        # assert that we are in fact in the declarative scan
        assert declarative_scan is not None

        reg = declarative_scan.declared_attr_reg

        if self in reg:
            return reg[self]
        else:
            reg[self] = obj = self.fget(cls)
            return obj


class _declared_directive(_declared_attr_common, Generic[_T]):
    # see mapping_api.rst for docstring

    if typing.TYPE_CHECKING:

        def __init__(
            self,
            fn: Callable[..., _T],
            cascading: bool = False,
        ):
            ...

        def __get__(self, instance: Optional[object], owner: Any) -> _T:
            ...

        def __set__(self, instance: Any, value: Any) -> None:
            ...

        def __delete__(self, instance: Any) -> None:
            ...

        def __call__(self, fn: Callable[..., _TT]) -> _declared_directive[_TT]:
            # extensive fooling of mypy underway...
            ...


class declared_attr(interfaces._MappedAttribute[_T], _declared_attr_common):
    """Mark a class-level method as representing the definition of
    a mapped property or Declarative directive.

    :class:`_orm.declared_attr` is typically applied as a decorator to a class
    level method, turning the attribute into a scalar-like property that can be
    invoked from the uninstantiated class. The Declarative mapping process
    looks for these :class:`_orm.declared_attr` callables as it scans classes,
    and assumes any attribute marked with :class:`_orm.declared_attr` will be a
    callable that will produce an object specific to the Declarative mapping or
    table configuration.

    :class:`_orm.declared_attr` is usually applicable to
    :ref:`mixins <orm_mixins_toplevel>`, to define relationships that are to be
    applied to different implementors of the class. It may also be used to
    define dynamically generated column expressions and other Declarative
    attributes.

    Example::

        class ProvidesUserMixin:
            "A mixin that adds a 'user' relationship to classes."

            user_id: Mapped[int] = mapped_column(ForeignKey("user_table.id"))

            @declared_attr
            def user(cls) -> Mapped["User"]:
                return relationship("User")

    When used with Declarative directives such as ``__tablename__``, the
    :meth:`_orm.declared_attr.directive` modifier may be used which indicates
    to :pep:`484` typing tools that the given method is not dealing with
    :class:`_orm.Mapped` attributes::

        class CreateTableName:
            @declared_attr.directive
            def __tablename__(cls) -> str:
                return cls.__name__.lower()

    :class:`_orm.declared_attr` can also be applied directly to mapped
    classes, to allow for attributes that dynamically configure themselves
    on subclasses when using mapped inheritance schemes.   Below
    illustrates :class:`_orm.declared_attr` to create a dynamic scheme
    for generating the :paramref:`_orm.Mapper.polymorphic_identity` parameter
    for subclasses::

        class Employee(Base):
            __tablename__ = 'employee'

            id: Mapped[int] = mapped_column(primary_key=True)
            type: Mapped[str] = mapped_column(String(50))

            @declared_attr.directive
            def __mapper_args__(cls) -> Dict[str, Any]:
                if cls.__name__ == 'Employee':
                    return {
                            "polymorphic_on":cls.type,
                            "polymorphic_identity":"Employee"
                    }
                else:
                    return {"polymorphic_identity":cls.__name__}

        class Engineer(Employee):
            pass

    :class:`_orm.declared_attr` supports decorating functions that are
    explicitly decorated with ``@classmethod``. This is never necessary from a
    runtime perspective, however may be needed in order to support :pep:`484`
    typing tools that don't otherwise recognize the decorated function as
    having class-level behaviors for the ``cls`` parameter::

        class SomethingMixin:
            x: Mapped[int]
            y: Mapped[int]

            @declared_attr
            @classmethod
            def x_plus_y(cls) -> Mapped[int]:
                return column_property(cls.x + cls.y)

    .. versionadded:: 2.0 - :class:`_orm.declared_attr` can accommodate a
       function decorated with ``@classmethod`` to help with :pep:`484`
       integration where needed.


    .. seealso::

        :ref:`orm_mixins_toplevel` - Declarative Mixin documentation with
        background on use patterns for :class:`_orm.declared_attr`.

    """  # noqa: E501

    if typing.TYPE_CHECKING:

        def __init__(
            self,
            fn: _DeclaredAttrDecorated[_T],
            cascading: bool = False,
        ):
            ...

        def __set__(self, instance: Any, value: Any) -> None:
            ...

        def __delete__(self, instance: Any) -> None:
            ...

        # this is the Mapped[] API where at class descriptor get time we want
        # the type checker to see InstrumentedAttribute[_T].   However the
        # callable function prior to mapping in fact calls the given
        # declarative function that does not return InstrumentedAttribute
        @overload
        def __get__(
            self, instance: None, owner: Any
        ) -> InstrumentedAttribute[_T]:
            ...

        @overload
        def __get__(self, instance: object, owner: Any) -> _T:
            ...

        def __get__(
            self, instance: Optional[object], owner: Any
        ) -> Union[InstrumentedAttribute[_T], _T]:
            ...

    @hybridmethod
    def _stateful(cls, **kw: Any) -> _stateful_declared_attr[_T]:
        return _stateful_declared_attr(**kw)

    @hybridproperty
    def directive(cls) -> _declared_directive[Any]:
        # see mapping_api.rst for docstring
        return _declared_directive  # type: ignore

    @hybridproperty
    def cascading(cls) -> _stateful_declared_attr[_T]:
        # see mapping_api.rst for docstring
        return cls._stateful(cascading=True)


class _stateful_declared_attr(declared_attr[_T]):
    kw: Dict[str, Any]

    def __init__(self, **kw: Any):
        self.kw = kw

    @hybridmethod
    def _stateful(self, **kw: Any) -> _stateful_declared_attr[_T]:
        new_kw = self.kw.copy()
        new_kw.update(kw)
        return _stateful_declared_attr(**new_kw)

    def __call__(self, fn: _DeclaredAttrDecorated[_T]) -> declared_attr[_T]:
        return declared_attr(fn, **self.kw)


def declarative_mixin(cls: Type[_T]) -> Type[_T]:
    """Mark a class as providing the feature of "declarative mixin".

    E.g.::

        from sqlalchemy.orm import declared_attr
        from sqlalchemy.orm import declarative_mixin

        @declarative_mixin
        class MyMixin:

            @declared_attr
            def __tablename__(cls):
                return cls.__name__.lower()

            __table_args__ = {'mysql_engine': 'InnoDB'}
            __mapper_args__= {'always_refresh': True}

            id =  Column(Integer, primary_key=True)

        class MyModel(MyMixin, Base):
            name = Column(String(1000))

    The :func:`_orm.declarative_mixin` decorator currently does not modify
    the given class in any way; it's current purpose is strictly to assist
    the :ref:`Mypy plugin <mypy_toplevel>` in being able to identify
    SQLAlchemy declarative mixin classes when no other context is present.

    .. versionadded:: 1.4.6

    .. seealso::

        :ref:`orm_mixins_toplevel`

        :ref:`mypy_declarative_mixins` - in the
        :ref:`Mypy plugin documentation <mypy_toplevel>`

    """  # noqa: E501

    return cls


def _setup_declarative_base(cls: Type[Any]) -> None:
    if "metadata" in cls.__dict__:
        metadata = cls.__dict__["metadata"]
    else:
        metadata = None

    if "type_annotation_map" in cls.__dict__:
        type_annotation_map = cls.__dict__["type_annotation_map"]
    else:
        type_annotation_map = None

    reg = cls.__dict__.get("registry", None)
    if reg is not None:
        if not isinstance(reg, registry):
            raise exc.InvalidRequestError(
                "Declarative base class has a 'registry' attribute that is "
                "not an instance of sqlalchemy.orm.registry()"
            )
        elif type_annotation_map is not None:
            raise exc.InvalidRequestError(
                "Declarative base class has both a 'registry' attribute and a "
                "type_annotation_map entry.  Per-base type_annotation_maps "
                "are not supported.  Please apply the type_annotation_map "
                "to this registry directly."
            )

    else:
        reg = registry(
            metadata=metadata, type_annotation_map=type_annotation_map
        )
        cls.registry = reg

    cls._sa_registry = reg

    if "metadata" not in cls.__dict__:
        cls.metadata = cls.registry.metadata

    if getattr(cls, "__init__", object.__init__) is object.__init__:
        cls.__init__ = cls.registry.constructor


class MappedAsDataclass(metaclass=DCTransformDeclarative):
    """Mixin class to indicate when mapping this class, also convert it to be
    a dataclass.

    .. seealso::

        :ref:`orm_declarative_native_dataclasses` - complete background
        on SQLAlchemy native dataclass mapping

    .. versionadded:: 2.0

    """

    def __init_subclass__(
        cls,
        init: Union[_NoArg, bool] = _NoArg.NO_ARG,
        repr: Union[_NoArg, bool] = _NoArg.NO_ARG,  # noqa: A002
        eq: Union[_NoArg, bool] = _NoArg.NO_ARG,
        order: Union[_NoArg, bool] = _NoArg.NO_ARG,
        unsafe_hash: Union[_NoArg, bool] = _NoArg.NO_ARG,
        match_args: Union[_NoArg, bool] = _NoArg.NO_ARG,
        kw_only: Union[_NoArg, bool] = _NoArg.NO_ARG,
        dataclass_callable: Union[
            _NoArg, Callable[..., Type[Any]]
        ] = _NoArg.NO_ARG,
        **kw: Any,
    ) -> None:
        apply_dc_transforms: _DataclassArguments = {
            "init": init,
            "repr": repr,
            "eq": eq,
            "order": order,
            "unsafe_hash": unsafe_hash,
            "match_args": match_args,
            "kw_only": kw_only,
            "dataclass_callable": dataclass_callable,
        }

        current_transforms: _DataclassArguments

        if hasattr(cls, "_sa_apply_dc_transforms"):
            current = cls._sa_apply_dc_transforms

            _ClassScanMapperConfig._assert_dc_arguments(current)

            cls._sa_apply_dc_transforms = current_transforms = {  # type: ignore  # noqa: E501
                k: current.get(k, _NoArg.NO_ARG) if v is _NoArg.NO_ARG else v
                for k, v in apply_dc_transforms.items()
            }
        else:
            cls._sa_apply_dc_transforms = (
                current_transforms
            ) = apply_dc_transforms

        super().__init_subclass__(**kw)

        if not _is_mapped_class(cls):
            new_anno = (
                _ClassScanMapperConfig._update_annotations_for_non_mapped_class
            )(cls)
            _ClassScanMapperConfig._apply_dataclasses_to_any_class(
                current_transforms, cls, new_anno
            )


class DeclarativeBase(
    # Inspectable is used only by the mypy plugin
    inspection.Inspectable[InstanceState[Any]],
    metaclass=DeclarativeAttributeIntercept,
):
    """Base class used for declarative class definitions.

    The :class:`_orm.DeclarativeBase` allows for the creation of new
    declarative bases in such a way that is compatible with type checkers::


        from sqlalchemy.orm import DeclarativeBase

        class Base(DeclarativeBase):
            pass


    The above ``Base`` class is now usable as the base for new declarative
    mappings.  The superclass makes use of the ``__init_subclass__()``
    method to set up new classes and metaclasses aren't used.

    When first used, the :class:`_orm.DeclarativeBase` class instantiates a new
    :class:`_orm.registry` to be used with the base, assuming one was not
    provided explicitly. The :class:`_orm.DeclarativeBase` class supports
    class-level attributes which act as parameters for the construction of this
    registry; such as to indicate a specific :class:`_schema.MetaData`
    collection as well as a specific value for
    :paramref:`_orm.registry.type_annotation_map`::

        from typing_extensions import Annotated

        from sqlalchemy import BigInteger
        from sqlalchemy import MetaData
        from sqlalchemy import String
        from sqlalchemy.orm import DeclarativeBase

        bigint = Annotated[int, "bigint"]
        my_metadata = MetaData()

        class Base(DeclarativeBase):
            metadata = my_metadata
            type_annotation_map = {
                str: String().with_variant(String(255), "mysql", "mariadb"),
                bigint: BigInteger()
            }

    Class-level attributes which may be specified include:

    :param metadata: optional :class:`_schema.MetaData` collection.
     If a :class:`_orm.registry` is constructed automatically, this
     :class:`_schema.MetaData` collection will be used to construct it.
     Otherwise, the local :class:`_schema.MetaData` collection will supercede
     that used by an existing :class:`_orm.registry` passed using the
     :paramref:`_orm.DeclarativeBase.registry` parameter.
    :param type_annotation_map: optional type annotation map that will be
     passed to the :class:`_orm.registry` as
     :paramref:`_orm.registry.type_annotation_map`.
    :param registry: supply a pre-existing :class:`_orm.registry` directly.

    .. versionadded:: 2.0  Added :class:`.DeclarativeBase`, so that declarative
       base classes may be constructed in such a way that is also recognized
       by :pep:`484` type checkers.   As a result, :class:`.DeclarativeBase`
       and other subclassing-oriented APIs should be seen as
       superseding previous "class returned by a function" APIs, namely
       :func:`_orm.declarative_base` and :meth:`_orm.registry.generate_base`,
       where the base class returned cannot be recognized by type checkers
       without using plugins.

    **__init__ behavior**

    In a plain Python class, the base-most ``__init__()`` method in the class
    hierarchy is ``object.__init__()``, which accepts no arguments. However,
    when the :class:`_orm.DeclarativeBase` subclass is first declared, the
    class is given an ``__init__()`` method that links to the
    :paramref:`_orm.registry.constructor` constructor function, if no
    ``__init__()`` method is already present; this is the usual declarative
    constructor that will assign keyword arguments as attributes on the
    instance, assuming those attributes are established at the class level
    (i.e. are mapped, or are linked to a descriptor). This constructor is
    **never accessed by a mapped class without being called explicitly via
    super()**, as mapped classes are themselves given an ``__init__()`` method
    directly which calls :paramref:`_orm.registry.constructor`, so in the
    default case works independently of what the base-most ``__init__()``
    method does.

    .. versionchanged:: 2.0.1  :class:`_orm.DeclarativeBase` has a default
       constructor that links to :paramref:`_orm.registry.constructor` by
       default, so that calls to ``super().__init__()`` can access this
       constructor. Previously, due to an implementation mistake, this default
       constructor was missing, and calling ``super().__init__()`` would invoke
       ``object.__init__()``.

    The :class:`_orm.DeclarativeBase` subclass may also declare an explicit
    ``__init__()`` method which will replace the use of the
    :paramref:`_orm.registry.constructor` function at this level::

        class Base(DeclarativeBase):
            def __init__(self, id=None):
                self.id = id

    Mapped classes still will not invoke this constructor implicitly; it
    remains only accessible by calling ``super().__init__()``::

        class MyClass(Base):
            def __init__(self, id=None, name=None):
                self.name = name
                super().__init__(id=id)

    Note that this is a different behavior from what functions like the legacy
    :func:`_orm.declarative_base` would do; the base created by those functions
    would always install :paramref:`_orm.registry.constructor` for
    ``__init__()``.


    """

    if typing.TYPE_CHECKING:

        def _sa_inspect_type(self) -> Mapper[Self]:
            ...

        def _sa_inspect_instance(self) -> InstanceState[Self]:
            ...

        _sa_registry: ClassVar[_RegistryType]

        registry: ClassVar[_RegistryType]
        """Refers to the :class:`_orm.registry` in use where new
        :class:`_orm.Mapper` objects will be associated."""

        metadata: ClassVar[MetaData]
        """Refers to the :class:`_schema.MetaData` collection that will be used
        for new :class:`_schema.Table` objects.

        .. seealso::

            :ref:`orm_declarative_metadata`

        """

        __name__: ClassVar[str]

        # this ideally should be Mapper[Self], but mypy as of 1.4.1 does not
        # like it, and breaks the declared_attr_one test. Pyright/pylance is
        # ok with it.
        __mapper__: ClassVar[Mapper[Any]]
        """The :class:`_orm.Mapper` object to which a particular class is
        mapped.

        May also be acquired using :func:`_sa.inspect`, e.g.
        ``inspect(klass)``.

        """

        __table__: ClassVar[FromClause]
        """The :class:`_sql.FromClause` to which a particular subclass is
        mapped.

        This is usually an instance of :class:`_schema.Table` but may also
        refer to other kinds of :class:`_sql.FromClause` such as
        :class:`_sql.Subquery`, depending on how the class is mapped.

        .. seealso::

            :ref:`orm_declarative_metadata`

        """

        # pyright/pylance do not consider a classmethod a ClassVar so use Any
        # https://github.com/microsoft/pylance-release/issues/3484
        __tablename__: Any
        """String name to assign to the generated
        :class:`_schema.Table` object, if not specified directly via
        :attr:`_orm.DeclarativeBase.__table__`.

        .. seealso::

            :ref:`orm_declarative_table`

        """

        __mapper_args__: Any
        """Dictionary of arguments which will be passed to the
        :class:`_orm.Mapper` constructor.

        .. seealso::

            :ref:`orm_declarative_mapper_options`

        """

        __table_args__: Any
        """A dictionary or tuple of arguments that will be passed to the
        :class:`_schema.Table` constructor.  See
        :ref:`orm_declarative_table_configuration`
        for background on the specific structure of this collection.

        .. seealso::

            :ref:`orm_declarative_table_configuration`

        """

        def __init__(self, **kw: Any):
            ...

    def __init_subclass__(cls, **kw: Any) -> None:
        if DeclarativeBase in cls.__bases__:
            _check_not_declarative(cls, DeclarativeBase)
            _setup_declarative_base(cls)
        else:
            _as_declarative(cls._sa_registry, cls, cls.__dict__)
        super().__init_subclass__(**kw)


def _check_not_declarative(cls: Type[Any], base: Type[Any]) -> None:
    cls_dict = cls.__dict__
    if (
        "__table__" in cls_dict
        and not (
            callable(cls_dict["__table__"])
            or hasattr(cls_dict["__table__"], "__get__")
        )
    ) or isinstance(cls_dict.get("__tablename__", None), str):
        raise exc.InvalidRequestError(
            f"Cannot use {base.__name__!r} directly as a declarative base "
            "class. Create a Base by creating a subclass of it."
        )


class DeclarativeBaseNoMeta(
    # Inspectable is used only by the mypy plugin
    inspection.Inspectable[InstanceState[Any]]
):
    """Same as :class:`_orm.DeclarativeBase`, but does not use a metaclass
    to intercept new attributes.

    The :class:`_orm.DeclarativeBaseNoMeta` base may be used when use of
    custom metaclasses is desirable.

    .. versionadded:: 2.0


    """

    _sa_registry: ClassVar[_RegistryType]

    registry: ClassVar[_RegistryType]
    """Refers to the :class:`_orm.registry` in use where new
    :class:`_orm.Mapper` objects will be associated."""

    metadata: ClassVar[MetaData]
    """Refers to the :class:`_schema.MetaData` collection that will be used
    for new :class:`_schema.Table` objects.

    .. seealso::

        :ref:`orm_declarative_metadata`

    """

    # this ideally should be Mapper[Self], but mypy as of 1.4.1 does not
    # like it, and breaks the declared_attr_one test. Pyright/pylance is
    # ok with it.
    __mapper__: ClassVar[Mapper[Any]]
    """The :class:`_orm.Mapper` object to which a particular class is
    mapped.

    May also be acquired using :func:`_sa.inspect`, e.g.
    ``inspect(klass)``.

    """

    __table__: Optional[FromClause]
    """The :class:`_sql.FromClause` to which a particular subclass is
    mapped.

    This is usually an instance of :class:`_schema.Table` but may also
    refer to other kinds of :class:`_sql.FromClause` such as
    :class:`_sql.Subquery`, depending on how the class is mapped.

    .. seealso::

        :ref:`orm_declarative_metadata`

    """

    if typing.TYPE_CHECKING:

        def _sa_inspect_type(self) -> Mapper[Self]:
            ...

        def _sa_inspect_instance(self) -> InstanceState[Self]:
            ...

        __tablename__: Any
        """String name to assign to the generated
        :class:`_schema.Table` object, if not specified directly via
        :attr:`_orm.DeclarativeBase.__table__`.

        .. seealso::

            :ref:`orm_declarative_table`

        """

        __mapper_args__: Any
        """Dictionary of arguments which will be passed to the
        :class:`_orm.Mapper` constructor.

        .. seealso::

            :ref:`orm_declarative_mapper_options`

        """

        __table_args__: Any
        """A dictionary or tuple of arguments that will be passed to the
        :class:`_schema.Table` constructor.  See
        :ref:`orm_declarative_table_configuration`
        for background on the specific structure of this collection.

        .. seealso::

            :ref:`orm_declarative_table_configuration`

        """

        def __init__(self, **kw: Any):
            ...

    def __init_subclass__(cls, **kw: Any) -> None:
        if DeclarativeBaseNoMeta in cls.__bases__:
            _check_not_declarative(cls, DeclarativeBaseNoMeta)
            _setup_declarative_base(cls)
        else:
            _as_declarative(cls._sa_registry, cls, cls.__dict__)
        super().__init_subclass__(**kw)


def add_mapped_attribute(
    target: Type[_O], key: str, attr: MapperProperty[Any]
) -> None:
    """Add a new mapped attribute to an ORM mapped class.

    E.g.::

        add_mapped_attribute(User, "addresses", relationship(Address))

    This may be used for ORM mappings that aren't using a declarative
    metaclass that intercepts attribute set operations.

    .. versionadded:: 2.0


    """
    _add_attribute(target, key, attr)


def declarative_base(
    *,
    metadata: Optional[MetaData] = None,
    mapper: Optional[Callable[..., Mapper[Any]]] = None,
    cls: Type[Any] = object,
    name: str = "Base",
    class_registry: Optional[clsregistry._ClsRegistryType] = None,
    type_annotation_map: Optional[_TypeAnnotationMapType] = None,
    constructor: Callable[..., None] = _declarative_constructor,
    metaclass: Type[Any] = DeclarativeMeta,
) -> Any:
    r"""Construct a base class for declarative class definitions.

    The new base class will be given a metaclass that produces
    appropriate :class:`~sqlalchemy.schema.Table` objects and makes
    the appropriate :class:`_orm.Mapper` calls based on the
    information provided declaratively in the class and any subclasses
    of the class.

    .. versionchanged:: 2.0 Note that the :func:`_orm.declarative_base`
       function is superseded by the new :class:`_orm.DeclarativeBase` class,
       which generates a new "base" class using subclassing, rather than
       return value of a function.  This allows an approach that is compatible
       with :pep:`484` typing tools.

    The :func:`_orm.declarative_base` function is a shorthand version
    of using the :meth:`_orm.registry.generate_base`
    method.  That is, the following::

        from sqlalchemy.orm import declarative_base

        Base = declarative_base()

    Is equivalent to::

        from sqlalchemy.orm import registry

        mapper_registry = registry()
        Base = mapper_registry.generate_base()

    See the docstring for :class:`_orm.registry`
    and :meth:`_orm.registry.generate_base`
    for more details.

    .. versionchanged:: 1.4  The :func:`_orm.declarative_base`
       function is now a specialization of the more generic
       :class:`_orm.registry` class.  The function also moves to the
       ``sqlalchemy.orm`` package from the ``declarative.ext`` package.


    :param metadata:
      An optional :class:`~sqlalchemy.schema.MetaData` instance.  All
      :class:`~sqlalchemy.schema.Table` objects implicitly declared by
      subclasses of the base will share this MetaData.  A MetaData instance
      will be created if none is provided.  The
      :class:`~sqlalchemy.schema.MetaData` instance will be available via the
      ``metadata`` attribute of the generated declarative base class.

    :param mapper:
      An optional callable, defaults to :class:`_orm.Mapper`. Will
      be used to map subclasses to their Tables.

    :param cls:
      Defaults to :class:`object`. A type to use as the base for the generated
      declarative base class. May be a class or tuple of classes.

    :param name:
      Defaults to ``Base``.  The display name for the generated
      class.  Customizing this is not required, but can improve clarity in
      tracebacks and debugging.

    :param constructor:
      Specify the implementation for the ``__init__`` function on a mapped
      class that has no ``__init__`` of its own.  Defaults to an
      implementation that assigns \**kwargs for declared
      fields and relationships to an instance.  If ``None`` is supplied,
      no __init__ will be provided and construction will fall back to
      cls.__init__ by way of the normal Python semantics.

    :param class_registry: optional dictionary that will serve as the
      registry of class names-> mapped classes when string names
      are used to identify classes inside of :func:`_orm.relationship`
      and others.  Allows two or more declarative base classes
      to share the same registry of class names for simplified
      inter-base relationships.

    :param type_annotation_map: optional dictionary of Python types to
        SQLAlchemy :class:`_types.TypeEngine` classes or instances.  This
        is used exclusively by the :class:`_orm.MappedColumn` construct
        to produce column types based on annotations within the
        :class:`_orm.Mapped` type.


        .. versionadded:: 2.0

        .. seealso::

            :ref:`orm_declarative_mapped_column_type_map`

    :param metaclass:
      Defaults to :class:`.DeclarativeMeta`.  A metaclass or __metaclass__
      compatible callable to use as the meta type of the generated
      declarative base class.

    .. seealso::

        :class:`_orm.registry`

    """

    return registry(
        metadata=metadata,
        class_registry=class_registry,
        constructor=constructor,
        type_annotation_map=type_annotation_map,
    ).generate_base(
        mapper=mapper,
        cls=cls,
        name=name,
        metaclass=metaclass,
    )


class registry:
    """Generalized registry for mapping classes.

    The :class:`_orm.registry` serves as the basis for maintaining a collection
    of mappings, and provides configurational hooks used to map classes.

    The three general kinds of mappings supported are Declarative Base,
    Declarative Decorator, and Imperative Mapping.   All of these mapping
    styles may be used interchangeably:

    * :meth:`_orm.registry.generate_base` returns a new declarative base
      class, and is the underlying implementation of the
      :func:`_orm.declarative_base` function.

    * :meth:`_orm.registry.mapped` provides a class decorator that will
      apply declarative mapping to a class without the use of a declarative
      base class.

    * :meth:`_orm.registry.map_imperatively` will produce a
      :class:`_orm.Mapper` for a class without scanning the class for
      declarative class attributes. This method suits the use case historically
      provided by the ``sqlalchemy.orm.mapper()`` classical mapping function,
      which is removed as of SQLAlchemy 2.0.

    .. versionadded:: 1.4

    .. seealso::

        :ref:`orm_mapping_classes_toplevel` - overview of class mapping
        styles.

    """

    _class_registry: clsregistry._ClsRegistryType
    _managers: weakref.WeakKeyDictionary[ClassManager[Any], Literal[True]]
    _non_primary_mappers: weakref.WeakKeyDictionary[Mapper[Any], Literal[True]]
    metadata: MetaData
    constructor: CallableReference[Callable[..., None]]
    type_annotation_map: _MutableTypeAnnotationMapType
    _dependents: Set[_RegistryType]
    _dependencies: Set[_RegistryType]
    _new_mappers: bool

    def __init__(
        self,
        *,
        metadata: Optional[MetaData] = None,
        class_registry: Optional[clsregistry._ClsRegistryType] = None,
        type_annotation_map: Optional[_TypeAnnotationMapType] = None,
        constructor: Callable[..., None] = _declarative_constructor,
    ):
        r"""Construct a new :class:`_orm.registry`

        :param metadata:
          An optional :class:`_schema.MetaData` instance.  All
          :class:`_schema.Table` objects generated using declarative
          table mapping will make use of this :class:`_schema.MetaData`
          collection.  If this argument is left at its default of ``None``,
          a blank :class:`_schema.MetaData` collection is created.

        :param constructor:
          Specify the implementation for the ``__init__`` function on a mapped
          class that has no ``__init__`` of its own.  Defaults to an
          implementation that assigns \**kwargs for declared
          fields and relationships to an instance.  If ``None`` is supplied,
          no __init__ will be provided and construction will fall back to
          cls.__init__ by way of the normal Python semantics.

        :param class_registry: optional dictionary that will serve as the
          registry of class names-> mapped classes when string names
          are used to identify classes inside of :func:`_orm.relationship`
          and others.  Allows two or more declarative base classes
          to share the same registry of class names for simplified
          inter-base relationships.

        :param type_annotation_map: optional dictionary of Python types to
          SQLAlchemy :class:`_types.TypeEngine` classes or instances.
          The provided dict will update the default type mapping.  This
          is used exclusively by the :class:`_orm.MappedColumn` construct
          to produce column types based on annotations within the
          :class:`_orm.Mapped` type.

          .. versionadded:: 2.0

          .. seealso::

              :ref:`orm_declarative_mapped_column_type_map`


        """
        lcl_metadata = metadata or MetaData()

        if class_registry is None:
            class_registry = weakref.WeakValueDictionary()

        self._class_registry = class_registry
        self._managers = weakref.WeakKeyDictionary()
        self._non_primary_mappers = weakref.WeakKeyDictionary()
        self.metadata = lcl_metadata
        self.constructor = constructor
        self.type_annotation_map = {}
        if type_annotation_map is not None:
            self.update_type_annotation_map(type_annotation_map)
        self._dependents = set()
        self._dependencies = set()

        self._new_mappers = False

        with mapperlib._CONFIGURE_MUTEX:
            mapperlib._mapper_registries[self] = True

    def update_type_annotation_map(
        self,
        type_annotation_map: _TypeAnnotationMapType,
    ) -> None:
        """update the :paramref:`_orm.registry.type_annotation_map` with new
        values."""

        self.type_annotation_map.update(
            {
                sub_type: sqltype
                for typ, sqltype in type_annotation_map.items()
                for sub_type in compat_typing.expand_unions(
                    typ, include_union=True, discard_none=True
                )
            }
        )

    def _resolve_type(
        self, python_type: _MatchedOnType
    ) -> Optional[sqltypes.TypeEngine[Any]]:
        search: Iterable[Tuple[_MatchedOnType, Type[Any]]]
        python_type_type: Type[Any]

        if is_generic(python_type):
            if is_literal(python_type):
                python_type_type = cast("Type[Any]", python_type)

                search = (  # type: ignore[assignment]
                    (python_type, python_type_type),
                    (Literal, python_type_type),
                )
            else:
                python_type_type = python_type.__origin__
                search = ((python_type, python_type_type),)
        elif is_newtype(python_type):
            python_type_type = flatten_newtype(python_type)
            search = ((python_type, python_type_type),)
        elif is_pep695(python_type):
            python_type_type = python_type.__value__
            flattened = None
            search = ((python_type, python_type_type),)
        else:
            python_type_type = cast("Type[Any]", python_type)
            flattened = None
            search = ((pt, pt) for pt in python_type_type.__mro__)

        for pt, flattened in search:
            # we search through full __mro__ for types.  however...
            sql_type = self.type_annotation_map.get(pt)
            if sql_type is None:
                sql_type = sqltypes._type_map_get(pt)  # type: ignore  # noqa: E501

            if sql_type is not None:
                sql_type_inst = sqltypes.to_instance(sql_type)

                # ... this additional step will reject most
                # type -> supertype matches, such as if we had
                # a MyInt(int) subclass.  note also we pass NewType()
                # here directly; these always have to be in the
                # type_annotation_map to be useful
                resolved_sql_type = sql_type_inst._resolve_for_python_type(
                    python_type_type,
                    pt,
                    flattened,
                )
                if resolved_sql_type is not None:
                    return resolved_sql_type

        return None

    @property
    def mappers(self) -> FrozenSet[Mapper[Any]]:
        """read only collection of all :class:`_orm.Mapper` objects."""

        return frozenset(manager.mapper for manager in self._managers).union(
            self._non_primary_mappers
        )

    def _set_depends_on(self, registry: RegistryType) -> None:
        if registry is self:
            return
        registry._dependents.add(self)
        self._dependencies.add(registry)

    def _flag_new_mapper(self, mapper: Mapper[Any]) -> None:
        mapper._ready_for_configure = True
        if self._new_mappers:
            return

        for reg in self._recurse_with_dependents({self}):
            reg._new_mappers = True

    @classmethod
    def _recurse_with_dependents(
        cls, registries: Set[RegistryType]
    ) -> Iterator[RegistryType]:
        todo = registries
        done = set()
        while todo:
            reg = todo.pop()
            done.add(reg)

            # if yielding would remove dependents, make sure we have
            # them before
            todo.update(reg._dependents.difference(done))
            yield reg

            # if yielding would add dependents, make sure we have them
            # after
            todo.update(reg._dependents.difference(done))

    @classmethod
    def _recurse_with_dependencies(
        cls, registries: Set[RegistryType]
    ) -> Iterator[RegistryType]:
        todo = registries
        done = set()
        while todo:
            reg = todo.pop()
            done.add(reg)

            # if yielding would remove dependencies, make sure we have
            # them before
            todo.update(reg._dependencies.difference(done))

            yield reg

            # if yielding would remove dependencies, make sure we have
            # them before
            todo.update(reg._dependencies.difference(done))

    def _mappers_to_configure(self) -> Iterator[Mapper[Any]]:
        return itertools.chain(
            (
                manager.mapper
                for manager in list(self._managers)
                if manager.is_mapped
                and not manager.mapper.configured
                and manager.mapper._ready_for_configure
            ),
            (
                npm
                for npm in list(self._non_primary_mappers)
                if not npm.configured and npm._ready_for_configure
            ),
        )

    def _add_non_primary_mapper(self, np_mapper: Mapper[Any]) -> None:
        self._non_primary_mappers[np_mapper] = True

    def _dispose_cls(self, cls: Type[_O]) -> None:
        clsregistry.remove_class(cls.__name__, cls, self._class_registry)

    def _add_manager(self, manager: ClassManager[Any]) -> None:
        self._managers[manager] = True
        if manager.is_mapped:
            raise exc.ArgumentError(
                "Class '%s' already has a primary mapper defined. "
                % manager.class_
            )
        assert manager.registry is None
        manager.registry = self

    def configure(self, cascade: bool = False) -> None:
        """Configure all as-yet unconfigured mappers in this
        :class:`_orm.registry`.

        The configure step is used to reconcile and initialize the
        :func:`_orm.relationship` linkages between mapped classes, as well as
        to invoke configuration events such as the
        :meth:`_orm.MapperEvents.before_configured` and
        :meth:`_orm.MapperEvents.after_configured`, which may be used by ORM
        extensions or user-defined extension hooks.

        If one or more mappers in this registry contain
        :func:`_orm.relationship` constructs that refer to mapped classes in
        other registries, this registry is said to be *dependent* on those
        registries. In order to configure those dependent registries
        automatically, the :paramref:`_orm.registry.configure.cascade` flag
        should be set to ``True``. Otherwise, if they are not configured, an
        exception will be raised.  The rationale behind this behavior is to
        allow an application to programmatically invoke configuration of
        registries while controlling whether or not the process implicitly
        reaches other registries.

        As an alternative to invoking :meth:`_orm.registry.configure`, the ORM
        function :func:`_orm.configure_mappers` function may be used to ensure
        configuration is complete for all :class:`_orm.registry` objects in
        memory. This is generally simpler to use and also predates the usage of
        :class:`_orm.registry` objects overall. However, this function will
        impact all mappings throughout the running Python process and may be
        more memory/time consuming for an application that has many registries
        in use for different purposes that may not be needed immediately.

        .. seealso::

            :func:`_orm.configure_mappers`


        .. versionadded:: 1.4.0b2

        """
        mapperlib._configure_registries({self}, cascade=cascade)

    def dispose(self, cascade: bool = False) -> None:
        """Dispose of all mappers in this :class:`_orm.registry`.

        After invocation, all the classes that were mapped within this registry
        will no longer have class instrumentation associated with them. This
        method is the per-:class:`_orm.registry` analogue to the
        application-wide :func:`_orm.clear_mappers` function.

        If this registry contains mappers that are dependencies of other
        registries, typically via :func:`_orm.relationship` links, then those
        registries must be disposed as well. When such registries exist in
        relation to this one, their :meth:`_orm.registry.dispose` method will
        also be called, if the :paramref:`_orm.registry.dispose.cascade` flag
        is set to ``True``; otherwise, an error is raised if those registries
        were not already disposed.

        .. versionadded:: 1.4.0b2

        .. seealso::

            :func:`_orm.clear_mappers`

        """

        mapperlib._dispose_registries({self}, cascade=cascade)

    def _dispose_manager_and_mapper(self, manager: ClassManager[Any]) -> None:
        if "mapper" in manager.__dict__:
            mapper = manager.mapper

            mapper._set_dispose_flags()

        class_ = manager.class_
        self._dispose_cls(class_)
        instrumentation._instrumentation_factory.unregister(class_)

    def generate_base(
        self,
        mapper: Optional[Callable[..., Mapper[Any]]] = None,
        cls: Type[Any] = object,
        name: str = "Base",
        metaclass: Type[Any] = DeclarativeMeta,
    ) -> Any:
        """Generate a declarative base class.

        Classes that inherit from the returned class object will be
        automatically mapped using declarative mapping.

        E.g.::

            from sqlalchemy.orm import registry

            mapper_registry = registry()

            Base = mapper_registry.generate_base()

            class MyClass(Base):
                __tablename__ = "my_table"
                id = Column(Integer, primary_key=True)

        The above dynamically generated class is equivalent to the
        non-dynamic example below::

            from sqlalchemy.orm import registry
            from sqlalchemy.orm.decl_api import DeclarativeMeta

            mapper_registry = registry()

            class Base(metaclass=DeclarativeMeta):
                __abstract__ = True
                registry = mapper_registry
                metadata = mapper_registry.metadata

                __init__ = mapper_registry.constructor

        .. versionchanged:: 2.0 Note that the
           :meth:`_orm.registry.generate_base` method is superseded by the new
           :class:`_orm.DeclarativeBase` class, which generates a new "base"
           class using subclassing, rather than return value of a function.
           This allows an approach that is compatible with :pep:`484` typing
           tools.

        The :meth:`_orm.registry.generate_base` method provides the
        implementation for the :func:`_orm.declarative_base` function, which
        creates the :class:`_orm.registry` and base class all at once.

        See the section :ref:`orm_declarative_mapping` for background and
        examples.

        :param mapper:
          An optional callable, defaults to :class:`_orm.Mapper`.
          This function is used to generate new :class:`_orm.Mapper` objects.

        :param cls:
          Defaults to :class:`object`. A type to use as the base for the
          generated declarative base class. May be a class or tuple of classes.

        :param name:
          Defaults to ``Base``.  The display name for the generated
          class.  Customizing this is not required, but can improve clarity in
          tracebacks and debugging.

        :param metaclass:
          Defaults to :class:`.DeclarativeMeta`.  A metaclass or __metaclass__
          compatible callable to use as the meta type of the generated
          declarative base class.

        .. seealso::

            :ref:`orm_declarative_mapping`

            :func:`_orm.declarative_base`

        """
        metadata = self.metadata

        bases = not isinstance(cls, tuple) and (cls,) or cls

        class_dict: Dict[str, Any] = dict(registry=self, metadata=metadata)
        if isinstance(cls, type):
            class_dict["__doc__"] = cls.__doc__

        if self.constructor is not None:
            class_dict["__init__"] = self.constructor

        class_dict["__abstract__"] = True
        if mapper:
            class_dict["__mapper_cls__"] = mapper

        if hasattr(cls, "__class_getitem__"):

            def __class_getitem__(cls: Type[_T], key: Any) -> Type[_T]:
                # allow generic classes in py3.9+
                return cls

            class_dict["__class_getitem__"] = __class_getitem__

        return metaclass(name, bases, class_dict)

    @compat_typing.dataclass_transform(
        field_specifiers=(
            MappedColumn,
            RelationshipProperty,
            Composite,
            Synonym,
            mapped_column,
            relationship,
            composite,
            synonym,
            deferred,
        ),
    )
    @overload
    def mapped_as_dataclass(self, __cls: Type[_O]) -> Type[_O]:
        ...

    @overload
    def mapped_as_dataclass(
        self,
        __cls: Literal[None] = ...,
        *,
        init: Union[_NoArg, bool] = ...,
        repr: Union[_NoArg, bool] = ...,  # noqa: A002
        eq: Union[_NoArg, bool] = ...,
        order: Union[_NoArg, bool] = ...,
        unsafe_hash: Union[_NoArg, bool] = ...,
        match_args: Union[_NoArg, bool] = ...,
        kw_only: Union[_NoArg, bool] = ...,
        dataclass_callable: Union[_NoArg, Callable[..., Type[Any]]] = ...,
    ) -> Callable[[Type[_O]], Type[_O]]:
        ...

    def mapped_as_dataclass(
        self,
        __cls: Optional[Type[_O]] = None,
        *,
        init: Union[_NoArg, bool] = _NoArg.NO_ARG,
        repr: Union[_NoArg, bool] = _NoArg.NO_ARG,  # noqa: A002
        eq: Union[_NoArg, bool] = _NoArg.NO_ARG,
        order: Union[_NoArg, bool] = _NoArg.NO_ARG,
        unsafe_hash: Union[_NoArg, bool] = _NoArg.NO_ARG,
        match_args: Union[_NoArg, bool] = _NoArg.NO_ARG,
        kw_only: Union[_NoArg, bool] = _NoArg.NO_ARG,
        dataclass_callable: Union[
            _NoArg, Callable[..., Type[Any]]
        ] = _NoArg.NO_ARG,
    ) -> Union[Type[_O], Callable[[Type[_O]], Type[_O]]]:
        """Class decorator that will apply the Declarative mapping process
        to a given class, and additionally convert the class to be a
        Python dataclass.

        .. seealso::

            :ref:`orm_declarative_native_dataclasses` - complete background
            on SQLAlchemy native dataclass mapping


        .. versionadded:: 2.0


        """

        def decorate(cls: Type[_O]) -> Type[_O]:
            setattr(
                cls,
                "_sa_apply_dc_transforms",
                {
                    "init": init,
                    "repr": repr,
                    "eq": eq,
                    "order": order,
                    "unsafe_hash": unsafe_hash,
                    "match_args": match_args,
                    "kw_only": kw_only,
                    "dataclass_callable": dataclass_callable,
                },
            )
            _as_declarative(self, cls, cls.__dict__)
            return cls

        if __cls:
            return decorate(__cls)
        else:
            return decorate

    def mapped(self, cls: Type[_O]) -> Type[_O]:
        """Class decorator that will apply the Declarative mapping process
        to a given class.

        E.g.::

            from sqlalchemy.orm import registry

            mapper_registry = registry()

            @mapper_registry.mapped
            class Foo:
                __tablename__ = 'some_table'

                id = Column(Integer, primary_key=True)
                name = Column(String)

        See the section :ref:`orm_declarative_mapping` for complete
        details and examples.

        :param cls: class to be mapped.

        :return: the class that was passed.

        .. seealso::

            :ref:`orm_declarative_mapping`

            :meth:`_orm.registry.generate_base` - generates a base class
            that will apply Declarative mapping to subclasses automatically
            using a Python metaclass.

        .. seealso::

            :meth:`_orm.registry.mapped_as_dataclass`

        """
        _as_declarative(self, cls, cls.__dict__)
        return cls

    def as_declarative_base(self, **kw: Any) -> Callable[[Type[_T]], Type[_T]]:
        """
        Class decorator which will invoke
        :meth:`_orm.registry.generate_base`
        for a given base class.

        E.g.::

            from sqlalchemy.orm import registry

            mapper_registry = registry()

            @mapper_registry.as_declarative_base()
            class Base:
                @declared_attr
                def __tablename__(cls):
                    return cls.__name__.lower()
                id = Column(Integer, primary_key=True)

            class MyMappedClass(Base):
                # ...

        All keyword arguments passed to
        :meth:`_orm.registry.as_declarative_base` are passed
        along to :meth:`_orm.registry.generate_base`.

        """

        def decorate(cls: Type[_T]) -> Type[_T]:
            kw["cls"] = cls
            kw["name"] = cls.__name__
            return self.generate_base(**kw)  # type: ignore

        return decorate

    def map_declaratively(self, cls: Type[_O]) -> Mapper[_O]:
        """Map a class declaratively.

        In this form of mapping, the class is scanned for mapping information,
        including for columns to be associated with a table, and/or an
        actual table object.

        Returns the :class:`_orm.Mapper` object.

        E.g.::

            from sqlalchemy.orm import registry

            mapper_registry = registry()

            class Foo:
                __tablename__ = 'some_table'

                id = Column(Integer, primary_key=True)
                name = Column(String)

            mapper = mapper_registry.map_declaratively(Foo)

        This function is more conveniently invoked indirectly via either the
        :meth:`_orm.registry.mapped` class decorator or by subclassing a
        declarative metaclass generated from
        :meth:`_orm.registry.generate_base`.

        See the section :ref:`orm_declarative_mapping` for complete
        details and examples.

        :param cls: class to be mapped.

        :return: a :class:`_orm.Mapper` object.

        .. seealso::

            :ref:`orm_declarative_mapping`

            :meth:`_orm.registry.mapped` - more common decorator interface
            to this function.

            :meth:`_orm.registry.map_imperatively`

        """
        _as_declarative(self, cls, cls.__dict__)
        return cls.__mapper__  # type: ignore

    def map_imperatively(
        self,
        class_: Type[_O],
        local_table: Optional[FromClause] = None,
        **kw: Any,
    ) -> Mapper[_O]:
        r"""Map a class imperatively.

        In this form of mapping, the class is not scanned for any mapping
        information.  Instead, all mapping constructs are passed as
        arguments.

        This method is intended to be fully equivalent to the now-removed
        SQLAlchemy ``mapper()`` function, except that it's in terms of
        a particular registry.

        E.g.::

            from sqlalchemy.orm import registry

            mapper_registry = registry()

            my_table = Table(
                "my_table",
                mapper_registry.metadata,
                Column('id', Integer, primary_key=True)
            )

            class MyClass:
                pass

            mapper_registry.map_imperatively(MyClass, my_table)

        See the section :ref:`orm_imperative_mapping` for complete background
        and usage examples.

        :param class\_: The class to be mapped.  Corresponds to the
         :paramref:`_orm.Mapper.class_` parameter.

        :param local_table: the :class:`_schema.Table` or other
         :class:`_sql.FromClause` object that is the subject of the mapping.
         Corresponds to the
         :paramref:`_orm.Mapper.local_table` parameter.

        :param \**kw: all other keyword arguments are passed to the
         :class:`_orm.Mapper` constructor directly.

        .. seealso::

            :ref:`orm_imperative_mapping`

            :ref:`orm_declarative_mapping`

        """
        return _mapper(self, class_, local_table, kw)


RegistryType = registry

if not TYPE_CHECKING:
    # allow for runtime type resolution of ``ClassVar[_RegistryType]``
    _RegistryType = registry  # noqa


def as_declarative(**kw: Any) -> Callable[[Type[_T]], Type[_T]]:
    """
    Class decorator which will adapt a given class into a
    :func:`_orm.declarative_base`.

    This function makes use of the :meth:`_orm.registry.as_declarative_base`
    method, by first creating a :class:`_orm.registry` automatically
    and then invoking the decorator.

    E.g.::

        from sqlalchemy.orm import as_declarative

        @as_declarative()
        class Base:
            @declared_attr
            def __tablename__(cls):
                return cls.__name__.lower()
            id = Column(Integer, primary_key=True)

        class MyMappedClass(Base):
            # ...

    .. seealso::

        :meth:`_orm.registry.as_declarative_base`

    """
    metadata, class_registry = (
        kw.pop("metadata", None),
        kw.pop("class_registry", None),
    )

    return registry(
        metadata=metadata, class_registry=class_registry
    ).as_declarative_base(**kw)


@inspection._inspects(
    DeclarativeMeta, DeclarativeBase, DeclarativeAttributeIntercept
)
def _inspect_decl_meta(cls: Type[Any]) -> Optional[Mapper[Any]]:
    mp: Optional[Mapper[Any]] = _inspect_mapped_class(cls)
    if mp is None:
        if _DeferredMapperConfig.has_cls(cls):
            _DeferredMapperConfig.raise_unmapped_for_cls(cls)
    return mp
