# ext/declarative/extensions.py
# Copyright (C) 2005-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php
# mypy: ignore-errors


"""Public API functions and helpers for declarative."""
from __future__ import annotations

import collections
import contextlib
from typing import Any
from typing import Callable
from typing import TYPE_CHECKING
from typing import Union

from ... import exc as sa_exc
from ...engine import Connection
from ...engine import Engine
from ...orm import exc as orm_exc
from ...orm import relationships
from ...orm.base import _mapper_or_none
from ...orm.clsregistry import _resolver
from ...orm.decl_base import _DeferredMapperConfig
from ...orm.util import polymorphic_union
from ...schema import Table
from ...util import OrderedDict

if TYPE_CHECKING:
    from ...sql.schema import MetaData


class ConcreteBase:
    """A helper class for 'concrete' declarative mappings.

    :class:`.ConcreteBase` will use the :func:`.polymorphic_union`
    function automatically, against all tables mapped as a subclass
    to this class.   The function is called via the
    ``__declare_last__()`` function, which is essentially
    a hook for the :meth:`.after_configured` event.

    :class:`.ConcreteBase` produces a mapped
    table for the class itself.  Compare to :class:`.AbstractConcreteBase`,
    which does not.

    Example::

        from sqlalchemy.ext.declarative import ConcreteBase

        class Employee(ConcreteBase, Base):
            __tablename__ = 'employee'
            employee_id = Column(Integer, primary_key=True)
            name = Column(String(50))
            __mapper_args__ = {
                            'polymorphic_identity':'employee',
                            'concrete':True}

        class Manager(Employee):
            __tablename__ = 'manager'
            employee_id = Column(Integer, primary_key=True)
            name = Column(String(50))
            manager_data = Column(String(40))
            __mapper_args__ = {
                            'polymorphic_identity':'manager',
                            'concrete':True}


    The name of the discriminator column used by :func:`.polymorphic_union`
    defaults to the name ``type``.  To suit the use case of a mapping where an
    actual column in a mapped table is already named ``type``, the
    discriminator name can be configured by setting the
    ``_concrete_discriminator_name`` attribute::

        class Employee(ConcreteBase, Base):
            _concrete_discriminator_name = '_concrete_discriminator'

    .. versionadded:: 1.3.19 Added the ``_concrete_discriminator_name``
       attribute to :class:`_declarative.ConcreteBase` so that the
       virtual discriminator column name can be customized.

    .. versionchanged:: 1.4.2 The ``_concrete_discriminator_name`` attribute
       need only be placed on the basemost class to take correct effect for
       all subclasses.   An explicit error message is now raised if the
       mapped column names conflict with the discriminator name, whereas
       in the 1.3.x series there would be some warnings and then a non-useful
       query would be generated.

    .. seealso::

        :class:`.AbstractConcreteBase`

        :ref:`concrete_inheritance`


    """

    @classmethod
    def _create_polymorphic_union(cls, mappers, discriminator_name):
        return polymorphic_union(
            OrderedDict(
                (mp.polymorphic_identity, mp.local_table) for mp in mappers
            ),
            discriminator_name,
            "pjoin",
        )

    @classmethod
    def __declare_first__(cls):
        m = cls.__mapper__
        if m.with_polymorphic:
            return

        discriminator_name = (
            getattr(cls, "_concrete_discriminator_name", None) or "type"
        )

        mappers = list(m.self_and_descendants)
        pjoin = cls._create_polymorphic_union(mappers, discriminator_name)
        m._set_with_polymorphic(("*", pjoin))
        m._set_polymorphic_on(pjoin.c[discriminator_name])


class AbstractConcreteBase(ConcreteBase):
    """A helper class for 'concrete' declarative mappings.

    :class:`.AbstractConcreteBase` will use the :func:`.polymorphic_union`
    function automatically, against all tables mapped as a subclass
    to this class.   The function is called via the
    ``__declare_first__()`` function, which is essentially
    a hook for the :meth:`.before_configured` event.

    :class:`.AbstractConcreteBase` applies :class:`_orm.Mapper` for its
    immediately inheriting class, as would occur for any other
    declarative mapped class. However, the :class:`_orm.Mapper` is not
    mapped to any particular :class:`.Table` object.  Instead, it's
    mapped directly to the "polymorphic" selectable produced by
    :func:`.polymorphic_union`, and performs no persistence operations on its
    own.  Compare to :class:`.ConcreteBase`, which maps its
    immediately inheriting class to an actual
    :class:`.Table` that stores rows directly.

    .. note::

        The :class:`.AbstractConcreteBase` delays the mapper creation of the
        base class until all the subclasses have been defined,
        as it needs to create a mapping against a selectable that will include
        all subclass tables.  In order to achieve this, it waits for the
        **mapper configuration event** to occur, at which point it scans
        through all the configured subclasses and sets up a mapping that will
        query against all subclasses at once.

        While this event is normally invoked automatically, in the case of
        :class:`.AbstractConcreteBase`, it may be necessary to invoke it
        explicitly after **all** subclass mappings are defined, if the first
        operation is to be a query against this base class. To do so, once all
        the desired classes have been configured, the
        :meth:`_orm.registry.configure` method on the :class:`_orm.registry`
        in use can be invoked, which is available in relation to a particular
        declarative base class::

            Base.registry.configure()

    Example::

        from sqlalchemy.orm import DeclarativeBase
        from sqlalchemy.ext.declarative import AbstractConcreteBase

        class Base(DeclarativeBase):
            pass

        class Employee(AbstractConcreteBase, Base):
            pass

        class Manager(Employee):
            __tablename__ = 'manager'
            employee_id = Column(Integer, primary_key=True)
            name = Column(String(50))
            manager_data = Column(String(40))

            __mapper_args__ = {
                'polymorphic_identity':'manager',
                'concrete':True
            }

        Base.registry.configure()

    The abstract base class is handled by declarative in a special way;
    at class configuration time, it behaves like a declarative mixin
    or an ``__abstract__`` base class.   Once classes are configured
    and mappings are produced, it then gets mapped itself, but
    after all of its descendants.  This is a very unique system of mapping
    not found in any other SQLAlchemy API feature.

    Using this approach, we can specify columns and properties
    that will take place on mapped subclasses, in the way that
    we normally do as in :ref:`declarative_mixins`::

        from sqlalchemy.ext.declarative import AbstractConcreteBase

        class Company(Base):
            __tablename__ = 'company'
            id = Column(Integer, primary_key=True)

        class Employee(AbstractConcreteBase, Base):
            strict_attrs = True

            employee_id = Column(Integer, primary_key=True)

            @declared_attr
            def company_id(cls):
                return Column(ForeignKey('company.id'))

            @declared_attr
            def company(cls):
                return relationship("Company")

        class Manager(Employee):
            __tablename__ = 'manager'

            name = Column(String(50))
            manager_data = Column(String(40))

            __mapper_args__ = {
                'polymorphic_identity':'manager',
                'concrete':True
            }

        Base.registry.configure()

    When we make use of our mappings however, both ``Manager`` and
    ``Employee`` will have an independently usable ``.company`` attribute::

        session.execute(
            select(Employee).filter(Employee.company.has(id=5))
        )

    :param strict_attrs: when specified on the base class, "strict" attribute
     mode is enabled which attempts to limit ORM mapped attributes on the
     base class to only those that are immediately present, while still
     preserving "polymorphic" loading behavior.

     .. versionadded:: 2.0

    .. seealso::

        :class:`.ConcreteBase`

        :ref:`concrete_inheritance`

        :ref:`abstract_concrete_base`

    """

    __no_table__ = True

    @classmethod
    def __declare_first__(cls):
        cls._sa_decl_prepare_nocascade()

    @classmethod
    def _sa_decl_prepare_nocascade(cls):
        if getattr(cls, "__mapper__", None):
            return

        to_map = _DeferredMapperConfig.config_for_cls(cls)

        # can't rely on 'self_and_descendants' here
        # since technically an immediate subclass
        # might not be mapped, but a subclass
        # may be.
        mappers = []
        stack = list(cls.__subclasses__())
        while stack:
            klass = stack.pop()
            stack.extend(klass.__subclasses__())
            mn = _mapper_or_none(klass)
            if mn is not None:
                mappers.append(mn)

        discriminator_name = (
            getattr(cls, "_concrete_discriminator_name", None) or "type"
        )
        pjoin = cls._create_polymorphic_union(mappers, discriminator_name)

        # For columns that were declared on the class, these
        # are normally ignored with the "__no_table__" mapping,
        # unless they have a different attribute key vs. col name
        # and are in the properties argument.
        # In that case, ensure we update the properties entry
        # to the correct column from the pjoin target table.
        declared_cols = set(to_map.declared_columns)
        declared_col_keys = {c.key for c in declared_cols}
        for k, v in list(to_map.properties.items()):
            if v in declared_cols:
                to_map.properties[k] = pjoin.c[v.key]
                declared_col_keys.remove(v.key)

        to_map.local_table = pjoin

        strict_attrs = cls.__dict__.get("strict_attrs", False)

        m_args = to_map.mapper_args_fn or dict

        def mapper_args():
            args = m_args()
            args["polymorphic_on"] = pjoin.c[discriminator_name]
            args["polymorphic_abstract"] = True
            if strict_attrs:
                args["include_properties"] = (
                    set(pjoin.primary_key)
                    | declared_col_keys
                    | {discriminator_name}
                )
                args["with_polymorphic"] = ("*", pjoin)
            return args

        to_map.mapper_args_fn = mapper_args

        to_map.map()

        stack = [cls]
        while stack:
            scls = stack.pop(0)
            stack.extend(scls.__subclasses__())
            sm = _mapper_or_none(scls)
            if sm and sm.concrete and sm.inherits is None:
                for sup_ in scls.__mro__[1:]:
                    sup_sm = _mapper_or_none(sup_)
                    if sup_sm:
                        sm._set_concrete_base(sup_sm)
                        break

    @classmethod
    def _sa_raise_deferred_config(cls):
        raise orm_exc.UnmappedClassError(
            cls,
            msg="Class %s is a subclass of AbstractConcreteBase and "
            "has a mapping pending until all subclasses are defined. "
            "Call the sqlalchemy.orm.configure_mappers() function after "
            "all subclasses have been defined to "
            "complete the mapping of this class."
            % orm_exc._safe_cls_name(cls),
        )


class DeferredReflection:
    """A helper class for construction of mappings based on
    a deferred reflection step.

    Normally, declarative can be used with reflection by
    setting a :class:`_schema.Table` object using autoload_with=engine
    as the ``__table__`` attribute on a declarative class.
    The caveat is that the :class:`_schema.Table` must be fully
    reflected, or at the very least have a primary key column,
    at the point at which a normal declarative mapping is
    constructed, meaning the :class:`_engine.Engine` must be available
    at class declaration time.

    The :class:`.DeferredReflection` mixin moves the construction
    of mappers to be at a later point, after a specific
    method is called which first reflects all :class:`_schema.Table`
    objects created so far.   Classes can define it as such::

        from sqlalchemy.ext.declarative import declarative_base
        from sqlalchemy.ext.declarative import DeferredReflection
        Base = declarative_base()

        class MyClass(DeferredReflection, Base):
            __tablename__ = 'mytable'

    Above, ``MyClass`` is not yet mapped.   After a series of
    classes have been defined in the above fashion, all tables
    can be reflected and mappings created using
    :meth:`.prepare`::

        engine = create_engine("someengine://...")
        DeferredReflection.prepare(engine)

    The :class:`.DeferredReflection` mixin can be applied to individual
    classes, used as the base for the declarative base itself,
    or used in a custom abstract class.   Using an abstract base
    allows that only a subset of classes to be prepared for a
    particular prepare step, which is necessary for applications
    that use more than one engine.  For example, if an application
    has two engines, you might use two bases, and prepare each
    separately, e.g.::

        class ReflectedOne(DeferredReflection, Base):
            __abstract__ = True

        class ReflectedTwo(DeferredReflection, Base):
            __abstract__ = True

        class MyClass(ReflectedOne):
            __tablename__ = 'mytable'

        class MyOtherClass(ReflectedOne):
            __tablename__ = 'myothertable'

        class YetAnotherClass(ReflectedTwo):
            __tablename__ = 'yetanothertable'

        # ... etc.

    Above, the class hierarchies for ``ReflectedOne`` and
    ``ReflectedTwo`` can be configured separately::

        ReflectedOne.prepare(engine_one)
        ReflectedTwo.prepare(engine_two)

    .. seealso::

        :ref:`orm_declarative_reflected_deferred_reflection` - in the
        :ref:`orm_declarative_table_config_toplevel` section.

    """

    @classmethod
    def prepare(
        cls, bind: Union[Engine, Connection], **reflect_kw: Any
    ) -> None:
        r"""Reflect all :class:`_schema.Table` objects for all current
        :class:`.DeferredReflection` subclasses

        :param bind: :class:`_engine.Engine` or :class:`_engine.Connection`
         instance

         ..versionchanged:: 2.0.16 a :class:`_engine.Connection` is also
         accepted.

        :param \**reflect_kw: additional keyword arguments passed to
         :meth:`_schema.MetaData.reflect`, such as
         :paramref:`_schema.MetaData.reflect.views`.

         .. versionadded:: 2.0.16

        """

        to_map = _DeferredMapperConfig.classes_for_base(cls)

        metadata_to_table = collections.defaultdict(set)

        # first collect the primary __table__ for each class into a
        # collection of metadata/schemaname -> table names
        for thingy in to_map:
            if thingy.local_table is not None:
                metadata_to_table[
                    (thingy.local_table.metadata, thingy.local_table.schema)
                ].add(thingy.local_table.name)

        # then reflect all those tables into their metadatas

        if isinstance(bind, Connection):
            conn = bind
            ctx = contextlib.nullcontext(enter_result=conn)
        elif isinstance(bind, Engine):
            ctx = bind.connect()
        else:
            raise sa_exc.ArgumentError(
                f"Expected Engine or Connection, got {bind!r}"
            )

        with ctx as conn:
            for (metadata, schema), table_names in metadata_to_table.items():
                metadata.reflect(
                    conn,
                    only=table_names,
                    schema=schema,
                    extend_existing=True,
                    autoload_replace=False,
                    **reflect_kw,
                )

            metadata_to_table.clear()

            # .map() each class, then go through relationships and look
            # for secondary
            for thingy in to_map:
                thingy.map()

                mapper = thingy.cls.__mapper__
                metadata = mapper.class_.metadata

                for rel in mapper._props.values():
                    if (
                        isinstance(rel, relationships.RelationshipProperty)
                        and rel._init_args.secondary._is_populated()
                    ):
                        secondary_arg = rel._init_args.secondary

                        if isinstance(secondary_arg.argument, Table):
                            secondary_table = secondary_arg.argument
                            metadata_to_table[
                                (
                                    secondary_table.metadata,
                                    secondary_table.schema,
                                )
                            ].add(secondary_table.name)
                        elif isinstance(secondary_arg.argument, str):
                            _, resolve_arg = _resolver(rel.parent.class_, rel)

                            resolver = resolve_arg(
                                secondary_arg.argument, True
                            )
                            metadata_to_table[
                                (metadata, thingy.local_table.schema)
                            ].add(secondary_arg.argument)

                            resolver._resolvers += (
                                cls._sa_deferred_table_resolver(metadata),
                            )

                            secondary_arg.argument = resolver()

            for (metadata, schema), table_names in metadata_to_table.items():
                metadata.reflect(
                    conn,
                    only=table_names,
                    schema=schema,
                    extend_existing=True,
                    autoload_replace=False,
                )

    @classmethod
    def _sa_deferred_table_resolver(
        cls, metadata: MetaData
    ) -> Callable[[str], Table]:
        def _resolve(key: str) -> Table:
            # reflection has already occurred so this Table would have
            # its contents already
            return Table(key, metadata)

        return _resolve

    _sa_decl_prepare = True

    @classmethod
    def _sa_raise_deferred_config(cls):
        raise orm_exc.UnmappedClassError(
            cls,
            msg="Class %s is a subclass of DeferredReflection.  "
            "Mappings are not produced until the .prepare() "
            "method is called on the class hierarchy."
            % orm_exc._safe_cls_name(cls),
        )
