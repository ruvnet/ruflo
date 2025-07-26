# sql/events.py
# Copyright (C) 2005-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php

from __future__ import annotations

from typing import Any
from typing import TYPE_CHECKING

from .base import SchemaEventTarget
from .. import event

if TYPE_CHECKING:
    from .schema import Column
    from .schema import Constraint
    from .schema import SchemaItem
    from .schema import Table
    from ..engine.base import Connection
    from ..engine.interfaces import ReflectedColumn
    from ..engine.reflection import Inspector


class DDLEvents(event.Events[SchemaEventTarget]):
    """
    Define event listeners for schema objects,
    that is, :class:`.SchemaItem` and other :class:`.SchemaEventTarget`
    subclasses, including :class:`_schema.MetaData`, :class:`_schema.Table`,
    :class:`_schema.Column`, etc.

    **Create / Drop Events**

    Events emitted when CREATE and DROP commands are emitted to the database.
    The event hooks in this category include :meth:`.DDLEvents.before_create`,
    :meth:`.DDLEvents.after_create`, :meth:`.DDLEvents.before_drop`, and
    :meth:`.DDLEvents.after_drop`.

    These events are emitted when using schema-level methods such as
    :meth:`.MetaData.create_all` and :meth:`.MetaData.drop_all`. Per-object
    create/drop methods such as :meth:`.Table.create`, :meth:`.Table.drop`,
    :meth:`.Index.create` are also included, as well as dialect-specific
    methods such as :meth:`_postgresql.ENUM.create`.

    .. versionadded:: 2.0 :class:`.DDLEvents` event hooks now take place
       for non-table objects including constraints, indexes, and
       dialect-specific schema types.

    Event hooks may be attached directly to a :class:`_schema.Table` object or
    to a :class:`_schema.MetaData` collection, as well as to any
    :class:`.SchemaItem` class or object that can be individually created and
    dropped using a distinct SQL command. Such classes include :class:`.Index`,
    :class:`.Sequence`, and dialect-specific classes such as
    :class:`_postgresql.ENUM`.

    Example using the :meth:`.DDLEvents.after_create` event, where a custom
    event hook will emit an ``ALTER TABLE`` command on the current connection,
    after ``CREATE TABLE`` is emitted::

        from sqlalchemy import create_engine
        from sqlalchemy import event
        from sqlalchemy import Table, Column, Metadata, Integer

        m = MetaData()
        some_table = Table('some_table', m, Column('data', Integer))

        @event.listens_for(some_table, "after_create")
        def after_create(target, connection, **kw):
            connection.execute(text(
                "ALTER TABLE %s SET name=foo_%s" % (target.name, target.name)
            ))


        some_engine = create_engine("postgresql://scott:tiger@host/test")

        # will emit "CREATE TABLE some_table" as well as the above
        # "ALTER TABLE" statement afterwards
        m.create_all(some_engine)

    Constraint objects such as :class:`.ForeignKeyConstraint`,
    :class:`.UniqueConstraint`, :class:`.CheckConstraint` may also be
    subscribed to these events, however they will **not** normally produce
    events as these objects are usually rendered inline within an
    enclosing ``CREATE TABLE`` statement and implicitly dropped from a
    ``DROP TABLE`` statement.

    For the :class:`.Index` construct, the event hook will be emitted
    for ``CREATE INDEX``, however SQLAlchemy does not normally emit
    ``DROP INDEX`` when dropping tables as this is again implicit within the
    ``DROP TABLE`` statement.

    .. versionadded:: 2.0 Support for :class:`.SchemaItem` objects
       for create/drop events was expanded from its previous support for
       :class:`.MetaData` and :class:`.Table` to also include
       :class:`.Constraint` and all subclasses, :class:`.Index`,
       :class:`.Sequence` and some type-related constructs such as
       :class:`_postgresql.ENUM`.

    .. note:: These event hooks are only emitted within the scope of
       SQLAlchemy's create/drop methods; they are not necessarily supported
       by tools such as `alembic <https://alembic.sqlalchemy.org>`_.


    **Attachment Events**

    Attachment events are provided to customize
    behavior whenever a child schema element is associated
    with a parent, such as when a :class:`_schema.Column` is associated
    with its :class:`_schema.Table`, when a
    :class:`_schema.ForeignKeyConstraint`
    is associated with a :class:`_schema.Table`, etc.  These events include
    :meth:`.DDLEvents.before_parent_attach` and
    :meth:`.DDLEvents.after_parent_attach`.

    **Reflection Events**

    The :meth:`.DDLEvents.column_reflect` event is used to intercept
    and modify the in-Python definition of database columns when
    :term:`reflection` of database tables proceeds.

    **Use with Generic DDL**

    DDL events integrate closely with the
    :class:`.DDL` class and the :class:`.ExecutableDDLElement` hierarchy
    of DDL clause constructs, which are themselves appropriate
    as listener callables::

        from sqlalchemy import DDL
        event.listen(
            some_table,
            "after_create",
            DDL("ALTER TABLE %(table)s SET name=foo_%(table)s")
        )

    **Event Propagation to MetaData Copies**

    For all :class:`.DDLEvent` events, the ``propagate=True`` keyword argument
    will ensure that a given event handler is propagated to copies of the
    object, which are made when using the :meth:`_schema.Table.to_metadata`
    method::

        from sqlalchemy import DDL

        metadata = MetaData()
        some_table = Table("some_table", metadata, Column("data", Integer))

        event.listen(
            some_table,
            "after_create",
            DDL("ALTER TABLE %(table)s SET name=foo_%(table)s"),
            propagate=True
        )

        new_metadata = MetaData()
        new_table = some_table.to_metadata(new_metadata)

    The above :class:`.DDL` object will be associated with the
    :meth:`.DDLEvents.after_create` event for both the ``some_table`` and
    the ``new_table`` :class:`.Table` objects.

    .. seealso::

        :ref:`event_toplevel`

        :class:`.ExecutableDDLElement`

        :class:`.DDL`

        :ref:`schema_ddl_sequences`

    """

    _target_class_doc = "SomeSchemaClassOrObject"
    _dispatch_target = SchemaEventTarget

    def before_create(
        self, target: SchemaEventTarget, connection: Connection, **kw: Any
    ) -> None:
        r"""Called before CREATE statements are emitted.

        :param target: the :class:`.SchemaObject`, such as a
         :class:`_schema.MetaData` or :class:`_schema.Table`
         but also including all create/drop objects such as
         :class:`.Index`, :class:`.Sequence`, etc.,
         object which is the target of the event.

         .. versionadded:: 2.0 Support for all :class:`.SchemaItem` objects
            was added.

        :param connection: the :class:`_engine.Connection` where the
         CREATE statement or statements will be emitted.
        :param \**kw: additional keyword arguments relevant
         to the event.  The contents of this dictionary
         may vary across releases, and include the
         list of tables being generated for a metadata-level
         event, the checkfirst flag, and other
         elements used by internal events.

        :func:`.event.listen` accepts the ``propagate=True``
        modifier for this event; when True, the listener function will
        be established for any copies made of the target object,
        i.e. those copies that are generated when
        :meth:`_schema.Table.to_metadata` is used.

        :func:`.event.listen` accepts the ``insert=True``
        modifier for this event; when True, the listener function will
        be prepended to the internal list of events upon discovery, and execute
        before registered listener functions that do not pass this argument.

        """

    def after_create(
        self, target: SchemaEventTarget, connection: Connection, **kw: Any
    ) -> None:
        r"""Called after CREATE statements are emitted.

        :param target: the :class:`.SchemaObject`, such as a
         :class:`_schema.MetaData` or :class:`_schema.Table`
         but also including all create/drop objects such as
         :class:`.Index`, :class:`.Sequence`, etc.,
         object which is the target of the event.

         .. versionadded:: 2.0 Support for all :class:`.SchemaItem` objects
            was added.

        :param connection: the :class:`_engine.Connection` where the
         CREATE statement or statements have been emitted.
        :param \**kw: additional keyword arguments relevant
         to the event.  The contents of this dictionary
         may vary across releases, and include the
         list of tables being generated for a metadata-level
         event, the checkfirst flag, and other
         elements used by internal events.

        :func:`.event.listen` also accepts the ``propagate=True``
        modifier for this event; when True, the listener function will
        be established for any copies made of the target object,
        i.e. those copies that are generated when
        :meth:`_schema.Table.to_metadata` is used.

        """

    def before_drop(
        self, target: SchemaEventTarget, connection: Connection, **kw: Any
    ) -> None:
        r"""Called before DROP statements are emitted.

        :param target: the :class:`.SchemaObject`, such as a
         :class:`_schema.MetaData` or :class:`_schema.Table`
         but also including all create/drop objects such as
         :class:`.Index`, :class:`.Sequence`, etc.,
         object which is the target of the event.

         .. versionadded:: 2.0 Support for all :class:`.SchemaItem` objects
            was added.

        :param connection: the :class:`_engine.Connection` where the
         DROP statement or statements will be emitted.
        :param \**kw: additional keyword arguments relevant
         to the event.  The contents of this dictionary
         may vary across releases, and include the
         list of tables being generated for a metadata-level
         event, the checkfirst flag, and other
         elements used by internal events.

        :func:`.event.listen` also accepts the ``propagate=True``
        modifier for this event; when True, the listener function will
        be established for any copies made of the target object,
        i.e. those copies that are generated when
        :meth:`_schema.Table.to_metadata` is used.

        """

    def after_drop(
        self, target: SchemaEventTarget, connection: Connection, **kw: Any
    ) -> None:
        r"""Called after DROP statements are emitted.

        :param target: the :class:`.SchemaObject`, such as a
         :class:`_schema.MetaData` or :class:`_schema.Table`
         but also including all create/drop objects such as
         :class:`.Index`, :class:`.Sequence`, etc.,
         object which is the target of the event.

         .. versionadded:: 2.0 Support for all :class:`.SchemaItem` objects
            was added.

        :param connection: the :class:`_engine.Connection` where the
         DROP statement or statements have been emitted.
        :param \**kw: additional keyword arguments relevant
         to the event.  The contents of this dictionary
         may vary across releases, and include the
         list of tables being generated for a metadata-level
         event, the checkfirst flag, and other
         elements used by internal events.

        :func:`.event.listen` also accepts the ``propagate=True``
        modifier for this event; when True, the listener function will
        be established for any copies made of the target object,
        i.e. those copies that are generated when
        :meth:`_schema.Table.to_metadata` is used.

        """

    def before_parent_attach(
        self, target: SchemaEventTarget, parent: SchemaItem
    ) -> None:
        """Called before a :class:`.SchemaItem` is associated with
        a parent :class:`.SchemaItem`.

        :param target: the target object
        :param parent: the parent to which the target is being attached.

        :func:`.event.listen` also accepts the ``propagate=True``
        modifier for this event; when True, the listener function will
        be established for any copies made of the target object,
        i.e. those copies that are generated when
        :meth:`_schema.Table.to_metadata` is used.

        """

    def after_parent_attach(
        self, target: SchemaEventTarget, parent: SchemaItem
    ) -> None:
        """Called after a :class:`.SchemaItem` is associated with
        a parent :class:`.SchemaItem`.

        :param target: the target object
        :param parent: the parent to which the target is being attached.

        :func:`.event.listen` also accepts the ``propagate=True``
        modifier for this event; when True, the listener function will
        be established for any copies made of the target object,
        i.e. those copies that are generated when
        :meth:`_schema.Table.to_metadata` is used.

        """

    def _sa_event_column_added_to_pk_constraint(
        self, const: Constraint, col: Column[Any]
    ) -> None:
        """internal event hook used for primary key naming convention
        updates.

        """

    def column_reflect(
        self, inspector: Inspector, table: Table, column_info: ReflectedColumn
    ) -> None:
        """Called for each unit of 'column info' retrieved when
        a :class:`_schema.Table` is being reflected.

        This event is most easily used by applying it to a specific
        :class:`_schema.MetaData` instance, where it will take effect for
        all :class:`_schema.Table` objects within that
        :class:`_schema.MetaData` that undergo reflection::

            metadata = MetaData()

            @event.listens_for(metadata, 'column_reflect')
            def receive_column_reflect(inspector, table, column_info):
                # receives for all Table objects that are reflected
                # under this MetaData


            # will use the above event hook
            my_table = Table("my_table", metadata, autoload_with=some_engine)


        .. versionadded:: 1.4.0b2 The :meth:`_events.DDLEvents.column_reflect`
           hook may now be applied to a :class:`_schema.MetaData` object as
           well as the :class:`_schema.MetaData` class itself where it will
           take place for all :class:`_schema.Table` objects associated with
           the targeted :class:`_schema.MetaData`.

        It may also be applied to the :class:`_schema.Table` class across
        the board::

            from sqlalchemy import Table

            @event.listens_for(Table, 'column_reflect')
            def receive_column_reflect(inspector, table, column_info):
                # receives for all Table objects that are reflected

        It can also be applied to a specific :class:`_schema.Table` at the
        point that one is being reflected using the
        :paramref:`_schema.Table.listeners` parameter::

            t1 = Table(
                "my_table",
                autoload_with=some_engine,
                listeners=[
                    ('column_reflect', receive_column_reflect)
                ]
            )

        The dictionary of column information as returned by the
        dialect is passed, and can be modified.  The dictionary
        is that returned in each element of the list returned
        by :meth:`.reflection.Inspector.get_columns`:

            * ``name`` - the column's name, is applied to the
              :paramref:`_schema.Column.name` parameter

            * ``type`` - the type of this column, which should be an instance
              of :class:`~sqlalchemy.types.TypeEngine`, is applied to the
              :paramref:`_schema.Column.type` parameter

            * ``nullable`` - boolean flag if the column is NULL or NOT NULL,
              is applied to the :paramref:`_schema.Column.nullable` parameter

            * ``default`` - the column's server default value.  This is
              normally specified as a plain string SQL expression, however the
              event can pass a :class:`.FetchedValue`, :class:`.DefaultClause`,
              or :func:`_expression.text` object as well.  Is applied to the
              :paramref:`_schema.Column.server_default` parameter

        The event is called before any action is taken against
        this dictionary, and the contents can be modified; the following
        additional keys may be added to the dictionary to further modify
        how the :class:`_schema.Column` is constructed:


            * ``key`` - the string key that will be used to access this
              :class:`_schema.Column` in the ``.c`` collection; will be applied
              to the :paramref:`_schema.Column.key` parameter. Is also used
              for ORM mapping.  See the section
              :ref:`mapper_automated_reflection_schemes` for an example.

            * ``quote`` - force or un-force quoting on the column name;
              is applied to the :paramref:`_schema.Column.quote` parameter.

            * ``info`` - a dictionary of arbitrary data to follow along with
              the :class:`_schema.Column`, is applied to the
              :paramref:`_schema.Column.info` parameter.

        :func:`.event.listen` also accepts the ``propagate=True``
        modifier for this event; when True, the listener function will
        be established for any copies made of the target object,
        i.e. those copies that are generated when
        :meth:`_schema.Table.to_metadata` is used.

        .. seealso::

            :ref:`mapper_automated_reflection_schemes` -
            in the ORM mapping documentation

            :ref:`automap_intercepting_columns` -
            in the :ref:`automap_toplevel` documentation

            :ref:`metadata_reflection_dbagnostic_types` - in
            the :ref:`metadata_reflection_toplevel` documentation

        """
