# orm/mapper.py
# Copyright (C) 2005-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php
# mypy: allow-untyped-defs, allow-untyped-calls

"""Logic to map Python classes to and from selectables.

Defines the :class:`~sqlalchemy.orm.mapper.Mapper` class, the central
configurational unit which associates a class with a database table.

This is a semi-private module; the main configurational API of the ORM is
available in :class:`~sqlalchemy.orm.`.

"""
from __future__ import annotations

from collections import deque
from functools import reduce
from itertools import chain
import sys
import threading
from typing import Any
from typing import Callable
from typing import cast
from typing import Collection
from typing import Deque
from typing import Dict
from typing import FrozenSet
from typing import Generic
from typing import Iterable
from typing import Iterator
from typing import List
from typing import Mapping
from typing import Optional
from typing import Sequence
from typing import Set
from typing import Tuple
from typing import Type
from typing import TYPE_CHECKING
from typing import TypeVar
from typing import Union
import weakref

from . import attributes
from . import exc as orm_exc
from . import instrumentation
from . import loading
from . import properties
from . import util as orm_util
from ._typing import _O
from .base import _class_to_mapper
from .base import _parse_mapper_argument
from .base import _state_mapper
from .base import PassiveFlag
from .base import state_str
from .interfaces import _MappedAttribute
from .interfaces import EXT_SKIP
from .interfaces import InspectionAttr
from .interfaces import MapperProperty
from .interfaces import ORMEntityColumnsClauseRole
from .interfaces import ORMFromClauseRole
from .interfaces import StrategizedProperty
from .path_registry import PathRegistry
from .. import event
from .. import exc as sa_exc
from .. import inspection
from .. import log
from .. import schema
from .. import sql
from .. import util
from ..event import dispatcher
from ..event import EventTarget
from ..sql import base as sql_base
from ..sql import coercions
from ..sql import expression
from ..sql import operators
from ..sql import roles
from ..sql import TableClause
from ..sql import util as sql_util
from ..sql import visitors
from ..sql.cache_key import MemoizedHasCacheKey
from ..sql.elements import KeyedColumnElement
from ..sql.schema import Column
from ..sql.schema import Table
from ..sql.selectable import LABEL_STYLE_TABLENAME_PLUS_COL
from ..util import HasMemoized
from ..util import HasMemoized_ro_memoized_attribute
from ..util.typing import Literal

if TYPE_CHECKING:
    from ._typing import _IdentityKeyType
    from ._typing import _InstanceDict
    from ._typing import _ORMColumnExprArgument
    from ._typing import _RegistryType
    from .decl_api import registry
    from .dependency import DependencyProcessor
    from .descriptor_props import CompositeProperty
    from .descriptor_props import SynonymProperty
    from .events import MapperEvents
    from .instrumentation import ClassManager
    from .path_registry import CachingEntityRegistry
    from .properties import ColumnProperty
    from .relationships import RelationshipProperty
    from .state import InstanceState
    from .util import ORMAdapter
    from ..engine import Row
    from ..engine import RowMapping
    from ..sql._typing import _ColumnExpressionArgument
    from ..sql._typing import _EquivalentColumnMap
    from ..sql.base import ReadOnlyColumnCollection
    from ..sql.elements import ColumnClause
    from ..sql.elements import ColumnElement
    from ..sql.selectable import FromClause
    from ..util import OrderedSet


_T = TypeVar("_T", bound=Any)
_MP = TypeVar("_MP", bound="MapperProperty[Any]")
_Fn = TypeVar("_Fn", bound="Callable[..., Any]")


_WithPolymorphicArg = Union[
    Literal["*"],
    Tuple[
        Union[Literal["*"], Sequence[Union["Mapper[Any]", Type[Any]]]],
        Optional["FromClause"],
    ],
    Sequence[Union["Mapper[Any]", Type[Any]]],
]


_mapper_registries: weakref.WeakKeyDictionary[
    _RegistryType, bool
] = weakref.WeakKeyDictionary()


def _all_registries() -> Set[registry]:
    with _CONFIGURE_MUTEX:
        return set(_mapper_registries)


def _unconfigured_mappers() -> Iterator[Mapper[Any]]:
    for reg in _all_registries():
        yield from reg._mappers_to_configure()


_already_compiling = False


# a constant returned by _get_attr_by_column to indicate
# this mapper is not handling an attribute for a particular
# column
NO_ATTRIBUTE = util.symbol("NO_ATTRIBUTE")

# lock used to synchronize the "mapper configure" step
_CONFIGURE_MUTEX = threading.RLock()


@inspection._self_inspects
@log.class_logger
class Mapper(
    ORMFromClauseRole,
    ORMEntityColumnsClauseRole[_O],
    MemoizedHasCacheKey,
    InspectionAttr,
    log.Identified,
    inspection.Inspectable["Mapper[_O]"],
    EventTarget,
    Generic[_O],
):
    """Defines an association between a Python class and a database table or
    other relational structure, so that ORM operations against the class may
    proceed.

    The :class:`_orm.Mapper` object is instantiated using mapping methods
    present on the :class:`_orm.registry` object.  For information
    about instantiating new :class:`_orm.Mapper` objects, see
    :ref:`orm_mapping_classes_toplevel`.

    """

    dispatch: dispatcher[Mapper[_O]]

    _dispose_called = False
    _configure_failed: Any = False
    _ready_for_configure = False

    @util.deprecated_params(
        non_primary=(
            "1.3",
            "The :paramref:`.mapper.non_primary` parameter is deprecated, "
            "and will be removed in a future release.  The functionality "
            "of non primary mappers is now better suited using the "
            ":class:`.AliasedClass` construct, which can also be used "
            "as the target of a :func:`_orm.relationship` in 1.3.",
        ),
    )
    def __init__(
        self,
        class_: Type[_O],
        local_table: Optional[FromClause] = None,
        properties: Optional[Mapping[str, MapperProperty[Any]]] = None,
        primary_key: Optional[Iterable[_ORMColumnExprArgument[Any]]] = None,
        non_primary: bool = False,
        inherits: Optional[Union[Mapper[Any], Type[Any]]] = None,
        inherit_condition: Optional[_ColumnExpressionArgument[bool]] = None,
        inherit_foreign_keys: Optional[
            Sequence[_ORMColumnExprArgument[Any]]
        ] = None,
        always_refresh: bool = False,
        version_id_col: Optional[_ORMColumnExprArgument[Any]] = None,
        version_id_generator: Optional[
            Union[Literal[False], Callable[[Any], Any]]
        ] = None,
        polymorphic_on: Optional[
            Union[_ORMColumnExprArgument[Any], str, MapperProperty[Any]]
        ] = None,
        _polymorphic_map: Optional[Dict[Any, Mapper[Any]]] = None,
        polymorphic_identity: Optional[Any] = None,
        concrete: bool = False,
        with_polymorphic: Optional[_WithPolymorphicArg] = None,
        polymorphic_abstract: bool = False,
        polymorphic_load: Optional[Literal["selectin", "inline"]] = None,
        allow_partial_pks: bool = True,
        batch: bool = True,
        column_prefix: Optional[str] = None,
        include_properties: Optional[Sequence[str]] = None,
        exclude_properties: Optional[Sequence[str]] = None,
        passive_updates: bool = True,
        passive_deletes: bool = False,
        confirm_deleted_rows: bool = True,
        eager_defaults: Literal[True, False, "auto"] = "auto",
        legacy_is_orphan: bool = False,
        _compiled_cache_size: int = 100,
    ):
        r"""Direct constructor for a new :class:`_orm.Mapper` object.

        The :class:`_orm.Mapper` constructor is not called directly, and
        is normally invoked through the
        use of the :class:`_orm.registry` object through either the
        :ref:`Declarative <orm_declarative_mapping>` or
        :ref:`Imperative <orm_imperative_mapping>` mapping styles.

        .. versionchanged:: 2.0 The public facing ``mapper()`` function is
           removed; for a classical mapping configuration, use the
           :meth:`_orm.registry.map_imperatively` method.

        Parameters documented below may be passed to either the
        :meth:`_orm.registry.map_imperatively` method, or may be passed in the
        ``__mapper_args__`` declarative class attribute described at
        :ref:`orm_declarative_mapper_options`.

        :param class\_: The class to be mapped.  When using Declarative,
          this argument is automatically passed as the declared class
          itself.

        :param local_table: The :class:`_schema.Table` or other
           :class:`_sql.FromClause` (i.e. selectable) to which the class is
           mapped. May be ``None`` if this mapper inherits from another mapper
           using single-table inheritance. When using Declarative, this
           argument is automatically passed by the extension, based on what is
           configured via the :attr:`_orm.DeclarativeBase.__table__` attribute
           or via the :class:`_schema.Table` produced as a result of
           the :attr:`_orm.DeclarativeBase.__tablename__` attribute being
           present.

        :param polymorphic_abstract: Indicates this class will be mapped in a
            polymorphic hierarchy, but not directly instantiated. The class is
            mapped normally, except that it has no requirement for a
            :paramref:`_orm.Mapper.polymorphic_identity` within an inheritance
            hierarchy. The class however must be part of a polymorphic
            inheritance scheme which uses
            :paramref:`_orm.Mapper.polymorphic_on` at the base.

            .. versionadded:: 2.0

            .. seealso::

                :ref:`orm_inheritance_abstract_poly`

        :param always_refresh: If True, all query operations for this mapped
           class will overwrite all data within object instances that already
           exist within the session, erasing any in-memory changes with
           whatever information was loaded from the database. Usage of this
           flag is highly discouraged; as an alternative, see the method
           :meth:`_query.Query.populate_existing`.

        :param allow_partial_pks: Defaults to True.  Indicates that a
           composite primary key with some NULL values should be considered as
           possibly existing within the database. This affects whether a
           mapper will assign an incoming row to an existing identity, as well
           as if :meth:`.Session.merge` will check the database first for a
           particular primary key value. A "partial primary key" can occur if
           one has mapped to an OUTER JOIN, for example.

        :param batch: Defaults to ``True``, indicating that save operations
           of multiple entities can be batched together for efficiency.
           Setting to False indicates
           that an instance will be fully saved before saving the next
           instance.  This is used in the extremely rare case that a
           :class:`.MapperEvents` listener requires being called
           in between individual row persistence operations.

        :param column_prefix: A string which will be prepended
           to the mapped attribute name when :class:`_schema.Column`
           objects are automatically assigned as attributes to the
           mapped class.  Does not affect :class:`.Column` objects that
           are mapped explicitly in the :paramref:`.Mapper.properties`
           dictionary.

           This parameter is typically useful with imperative mappings
           that keep the :class:`.Table` object separate.  Below, assuming
           the ``user_table`` :class:`.Table` object has columns named
           ``user_id``, ``user_name``, and ``password``::

                class User(Base):
                    __table__ = user_table
                    __mapper_args__ = {'column_prefix':'_'}

           The above mapping will assign the ``user_id``, ``user_name``, and
           ``password`` columns to attributes named ``_user_id``,
           ``_user_name``, and ``_password`` on the mapped ``User`` class.

           The :paramref:`.Mapper.column_prefix` parameter is uncommon in
           modern use. For dealing with reflected tables, a more flexible
           approach to automating a naming scheme is to intercept the
           :class:`.Column` objects as they are reflected; see the section
           :ref:`mapper_automated_reflection_schemes` for notes on this usage
           pattern.

        :param concrete: If True, indicates this mapper should use concrete
           table inheritance with its parent mapper.

           See the section :ref:`concrete_inheritance` for an example.

        :param confirm_deleted_rows: defaults to True; when a DELETE occurs
          of one more rows based on specific primary keys, a warning is
          emitted when the number of rows matched does not equal the number
          of rows expected.  This parameter may be set to False to handle the
          case where database ON DELETE CASCADE rules may be deleting some of
          those rows automatically.  The warning may be changed to an
          exception in a future release.

        :param eager_defaults: if True, the ORM will immediately fetch the
          value of server-generated default values after an INSERT or UPDATE,
          rather than leaving them as expired to be fetched on next access.
          This can be used for event schemes where the server-generated values
          are needed immediately before the flush completes.

          The fetch of values occurs either by using ``RETURNING`` inline
          with the ``INSERT`` or ``UPDATE`` statement, or by adding an
          additional ``SELECT`` statement subsequent to the ``INSERT`` or
          ``UPDATE``, if the backend does not support ``RETURNING``.

          The use of ``RETURNING`` is extremely performant in particular for
          ``INSERT`` statements where SQLAlchemy can take advantage of
          :ref:`insertmanyvalues <engine_insertmanyvalues>`, whereas the use of
          an additional ``SELECT`` is relatively poor performing, adding
          additional SQL round trips which would be unnecessary if these new
          attributes are not to be accessed in any case.

          For this reason, :paramref:`.Mapper.eager_defaults` defaults to the
          string value ``"auto"``, which indicates that server defaults for
          INSERT should be fetched using ``RETURNING`` if the backing database
          supports it and if the dialect in use supports "insertmanyreturning"
          for an INSERT statement. If the backing database does not support
          ``RETURNING`` or "insertmanyreturning" is not available, server
          defaults will not be fetched.

          .. versionchanged:: 2.0.0rc1 added the "auto" option for
             :paramref:`.Mapper.eager_defaults`

          .. seealso::

                :ref:`orm_server_defaults`

          .. versionchanged:: 2.0.0  RETURNING now works with multiple rows
             INSERTed at once using the
             :ref:`insertmanyvalues <engine_insertmanyvalues>` feature, which
             among other things allows the :paramref:`.Mapper.eager_defaults`
             feature to be very performant on supporting backends.

        :param exclude_properties: A list or set of string column names to
          be excluded from mapping.

          .. seealso::

            :ref:`include_exclude_cols`

        :param include_properties: An inclusive list or set of string column
          names to map.

          .. seealso::

            :ref:`include_exclude_cols`

        :param inherits: A mapped class or the corresponding
          :class:`_orm.Mapper`
          of one indicating a superclass to which this :class:`_orm.Mapper`
          should *inherit* from.   The mapped class here must be a subclass
          of the other mapper's class.   When using Declarative, this argument
          is passed automatically as a result of the natural class
          hierarchy of the declared classes.

          .. seealso::

            :ref:`inheritance_toplevel`

        :param inherit_condition: For joined table inheritance, a SQL
           expression which will
           define how the two tables are joined; defaults to a natural join
           between the two tables.

        :param inherit_foreign_keys: When ``inherit_condition`` is used and
           the columns present are missing a :class:`_schema.ForeignKey`
           configuration, this parameter can be used to specify which columns
           are "foreign".  In most cases can be left as ``None``.

        :param legacy_is_orphan: Boolean, defaults to ``False``.
          When ``True``, specifies that "legacy" orphan consideration
          is to be applied to objects mapped by this mapper, which means
          that a pending (that is, not persistent) object is auto-expunged
          from an owning :class:`.Session` only when it is de-associated
          from *all* parents that specify a ``delete-orphan`` cascade towards
          this mapper.  The new default behavior is that the object is
          auto-expunged when it is de-associated with *any* of its parents
          that specify ``delete-orphan`` cascade.  This behavior is more
          consistent with that of a persistent object, and allows behavior to
          be consistent in more scenarios independently of whether or not an
          orphan object has been flushed yet or not.

          See the change note and example at :ref:`legacy_is_orphan_addition`
          for more detail on this change.

        :param non_primary: Specify that this :class:`_orm.Mapper`
          is in addition
          to the "primary" mapper, that is, the one used for persistence.
          The :class:`_orm.Mapper` created here may be used for ad-hoc
          mapping of the class to an alternate selectable, for loading
          only.

         .. seealso::

            :ref:`relationship_aliased_class` - the new pattern that removes
            the need for the :paramref:`_orm.Mapper.non_primary` flag.

        :param passive_deletes: Indicates DELETE behavior of foreign key
           columns when a joined-table inheritance entity is being deleted.
           Defaults to ``False`` for a base mapper; for an inheriting mapper,
           defaults to ``False`` unless the value is set to ``True``
           on the superclass mapper.

           When ``True``, it is assumed that ON DELETE CASCADE is configured
           on the foreign key relationships that link this mapper's table
           to its superclass table, so that when the unit of work attempts
           to delete the entity, it need only emit a DELETE statement for the
           superclass table, and not this table.

           When ``False``, a DELETE statement is emitted for this mapper's
           table individually.  If the primary key attributes local to this
           table are unloaded, then a SELECT must be emitted in order to
           validate these attributes; note that the primary key columns
           of a joined-table subclass are not part of the "primary key" of
           the object as a whole.

           Note that a value of ``True`` is **always** forced onto the
           subclass mappers; that is, it's not possible for a superclass
           to specify passive_deletes without this taking effect for
           all subclass mappers.

           .. seealso::

               :ref:`passive_deletes` - description of similar feature as
               used with :func:`_orm.relationship`

               :paramref:`.mapper.passive_updates` - supporting ON UPDATE
               CASCADE for joined-table inheritance mappers

        :param passive_updates: Indicates UPDATE behavior of foreign key
           columns when a primary key column changes on a joined-table
           inheritance mapping.   Defaults to ``True``.

           When True, it is assumed that ON UPDATE CASCADE is configured on
           the foreign key in the database, and that the database will handle
           propagation of an UPDATE from a source column to dependent columns
           on joined-table rows.

           When False, it is assumed that the database does not enforce
           referential integrity and will not be issuing its own CASCADE
           operation for an update.  The unit of work process will
           emit an UPDATE statement for the dependent columns during a
           primary key change.

           .. seealso::

               :ref:`passive_updates` - description of a similar feature as
               used with :func:`_orm.relationship`

               :paramref:`.mapper.passive_deletes` - supporting ON DELETE
               CASCADE for joined-table inheritance mappers

        :param polymorphic_load: Specifies "polymorphic loading" behavior
         for a subclass in an inheritance hierarchy (joined and single
         table inheritance only).   Valid values are:

          * "'inline'" - specifies this class should be part of
            the "with_polymorphic" mappers, e.g. its columns will be included
            in a SELECT query against the base.

          * "'selectin'" - specifies that when instances of this class
            are loaded, an additional SELECT will be emitted to retrieve
            the columns specific to this subclass.  The SELECT uses
            IN to fetch multiple subclasses at once.

         .. versionadded:: 1.2

         .. seealso::

            :ref:`with_polymorphic_mapper_config`

            :ref:`polymorphic_selectin`

        :param polymorphic_on: Specifies the column, attribute, or
          SQL expression used to determine the target class for an
          incoming row, when inheriting classes are present.

          May be specified as a string attribute name, or as a SQL
          expression such as a :class:`_schema.Column` or in a Declarative
          mapping a :func:`_orm.mapped_column` object.  It is typically
          expected that the SQL expression corresponds to a column in the
          base-most mapped :class:`.Table`::

            class Employee(Base):
                __tablename__ = 'employee'

                id: Mapped[int] = mapped_column(primary_key=True)
                discriminator: Mapped[str] = mapped_column(String(50))

                __mapper_args__ = {
                    "polymorphic_on":discriminator,
                    "polymorphic_identity":"employee"
                }

          It may also be specified
          as a SQL expression, as in this example where we
          use the :func:`.case` construct to provide a conditional
          approach::

            class Employee(Base):
                __tablename__ = 'employee'

                id: Mapped[int] = mapped_column(primary_key=True)
                discriminator: Mapped[str] = mapped_column(String(50))

                __mapper_args__ = {
                    "polymorphic_on":case(
                        (discriminator == "EN", "engineer"),
                        (discriminator == "MA", "manager"),
                        else_="employee"),
                    "polymorphic_identity":"employee"
                }

          It may also refer to any attribute using its string name,
          which is of particular use when using annotated column
          configurations::

                class Employee(Base):
                    __tablename__ = 'employee'

                    id: Mapped[int] = mapped_column(primary_key=True)
                    discriminator: Mapped[str]

                    __mapper_args__ = {
                        "polymorphic_on": "discriminator",
                        "polymorphic_identity": "employee"
                    }

          When setting ``polymorphic_on`` to reference an
          attribute or expression that's not present in the
          locally mapped :class:`_schema.Table`, yet the value
          of the discriminator should be persisted to the database,
          the value of the
          discriminator is not automatically set on new
          instances; this must be handled by the user,
          either through manual means or via event listeners.
          A typical approach to establishing such a listener
          looks like::

                from sqlalchemy import event
                from sqlalchemy.orm import object_mapper

                @event.listens_for(Employee, "init", propagate=True)
                def set_identity(instance, *arg, **kw):
                    mapper = object_mapper(instance)
                    instance.discriminator = mapper.polymorphic_identity

          Where above, we assign the value of ``polymorphic_identity``
          for the mapped class to the ``discriminator`` attribute,
          thus persisting the value to the ``discriminator`` column
          in the database.

          .. warning::

             Currently, **only one discriminator column may be set**, typically
             on the base-most class in the hierarchy. "Cascading" polymorphic
             columns are not yet supported.

          .. seealso::

            :ref:`inheritance_toplevel`

        :param polymorphic_identity: Specifies the value which
          identifies this particular class as returned by the column expression
          referred to by the :paramref:`_orm.Mapper.polymorphic_on` setting. As
          rows are received, the value corresponding to the
          :paramref:`_orm.Mapper.polymorphic_on` column expression is compared
          to this value, indicating which subclass should be used for the newly
          reconstructed object.

          .. seealso::

            :ref:`inheritance_toplevel`

        :param properties: A dictionary mapping the string names of object
           attributes to :class:`.MapperProperty` instances, which define the
           persistence behavior of that attribute.  Note that
           :class:`_schema.Column`
           objects present in
           the mapped :class:`_schema.Table` are automatically placed into
           ``ColumnProperty`` instances upon mapping, unless overridden.
           When using Declarative, this argument is passed automatically,
           based on all those :class:`.MapperProperty` instances declared
           in the declared class body.

           .. seealso::

               :ref:`orm_mapping_properties` - in the
               :ref:`orm_mapping_classes_toplevel`

        :param primary_key: A list of :class:`_schema.Column`
           objects, or alternatively string names of attribute names which
           refer to :class:`_schema.Column`, which define
           the primary key to be used against this mapper's selectable unit.
           This is normally simply the primary key of the ``local_table``, but
           can be overridden here.

           .. versionchanged:: 2.0.2 :paramref:`_orm.Mapper.primary_key`
              arguments may be indicated as string attribute names as well.

           .. seealso::

                :ref:`mapper_primary_key` - background and example use

        :param version_id_col: A :class:`_schema.Column`
           that will be used to keep a running version id of rows
           in the table.  This is used to detect concurrent updates or
           the presence of stale data in a flush.  The methodology is to
           detect if an UPDATE statement does not match the last known
           version id, a
           :class:`~sqlalchemy.orm.exc.StaleDataError` exception is
           thrown.
           By default, the column must be of :class:`.Integer` type,
           unless ``version_id_generator`` specifies an alternative version
           generator.

           .. seealso::

              :ref:`mapper_version_counter` - discussion of version counting
              and rationale.

        :param version_id_generator: Define how new version ids should
          be generated.  Defaults to ``None``, which indicates that
          a simple integer counting scheme be employed.  To provide a custom
          versioning scheme, provide a callable function of the form::

              def generate_version(version):
                  return next_version

          Alternatively, server-side versioning functions such as triggers,
          or programmatic versioning schemes outside of the version id
          generator may be used, by specifying the value ``False``.
          Please see :ref:`server_side_version_counter` for a discussion
          of important points when using this option.

          .. seealso::

             :ref:`custom_version_counter`

             :ref:`server_side_version_counter`


        :param with_polymorphic: A tuple in the form ``(<classes>,
            <selectable>)`` indicating the default style of "polymorphic"
            loading, that is, which tables are queried at once. <classes> is
            any single or list of mappers and/or classes indicating the
            inherited classes that should be loaded at once. The special value
            ``'*'`` may be used to indicate all descending classes should be
            loaded immediately. The second tuple argument <selectable>
            indicates a selectable that will be used to query for multiple
            classes.

            The :paramref:`_orm.Mapper.polymorphic_load` parameter may be
            preferable over the use of :paramref:`_orm.Mapper.with_polymorphic`
            in modern mappings to indicate a per-subclass technique of
            indicating polymorphic loading styles.

            .. seealso::

                :ref:`with_polymorphic_mapper_config`

        """
        self.class_ = util.assert_arg_type(class_, type, "class_")
        self._sort_key = "%s.%s" % (
            self.class_.__module__,
            self.class_.__name__,
        )

        self._primary_key_argument = util.to_list(primary_key)
        self.non_primary = non_primary

        self.always_refresh = always_refresh

        if isinstance(version_id_col, MapperProperty):
            self.version_id_prop = version_id_col
            self.version_id_col = None
        else:
            self.version_id_col = (
                coercions.expect(
                    roles.ColumnArgumentOrKeyRole,
                    version_id_col,
                    argname="version_id_col",
                )
                if version_id_col is not None
                else None
            )

        if version_id_generator is False:
            self.version_id_generator = False
        elif version_id_generator is None:
            self.version_id_generator = lambda x: (x or 0) + 1
        else:
            self.version_id_generator = version_id_generator

        self.concrete = concrete
        self.single = False

        if inherits is not None:
            self.inherits = _parse_mapper_argument(inherits)
        else:
            self.inherits = None

        if local_table is not None:
            self.local_table = coercions.expect(
                roles.StrictFromClauseRole,
                local_table,
                disable_inspection=True,
                argname="local_table",
            )
        elif self.inherits:
            # note this is a new flow as of 2.0 so that
            # .local_table need not be Optional
            self.local_table = self.inherits.local_table
            self.single = True
        else:
            raise sa_exc.ArgumentError(
                f"Mapper[{self.class_.__name__}(None)] has None for a "
                "primary table argument and does not specify 'inherits'"
            )

        if inherit_condition is not None:
            self.inherit_condition = coercions.expect(
                roles.OnClauseRole, inherit_condition
            )
        else:
            self.inherit_condition = None

        self.inherit_foreign_keys = inherit_foreign_keys
        self._init_properties = dict(properties) if properties else {}
        self._delete_orphans = []
        self.batch = batch
        self.eager_defaults = eager_defaults
        self.column_prefix = column_prefix

        # interim - polymorphic_on is further refined in
        # _configure_polymorphic_setter
        self.polymorphic_on = (
            coercions.expect(  # type: ignore
                roles.ColumnArgumentOrKeyRole,
                polymorphic_on,
                argname="polymorphic_on",
            )
            if polymorphic_on is not None
            else None
        )
        self.polymorphic_abstract = polymorphic_abstract
        self._dependency_processors = []
        self.validators = util.EMPTY_DICT
        self.passive_updates = passive_updates
        self.passive_deletes = passive_deletes
        self.legacy_is_orphan = legacy_is_orphan
        self._clause_adapter = None
        self._requires_row_aliasing = False
        self._inherits_equated_pairs = None
        self._memoized_values = {}
        self._compiled_cache_size = _compiled_cache_size
        self._reconstructor = None
        self.allow_partial_pks = allow_partial_pks

        if self.inherits and not self.concrete:
            self.confirm_deleted_rows = False
        else:
            self.confirm_deleted_rows = confirm_deleted_rows

        self._set_with_polymorphic(with_polymorphic)
        self.polymorphic_load = polymorphic_load

        # our 'polymorphic identity', a string name that when located in a
        #  result set row indicates this Mapper should be used to construct
        # the object instance for that row.
        self.polymorphic_identity = polymorphic_identity

        # a dictionary of 'polymorphic identity' names, associating those
        # names with Mappers that will be used to construct object instances
        # upon a select operation.
        if _polymorphic_map is None:
            self.polymorphic_map = {}
        else:
            self.polymorphic_map = _polymorphic_map

        if include_properties is not None:
            self.include_properties = util.to_set(include_properties)
        else:
            self.include_properties = None
        if exclude_properties:
            self.exclude_properties = util.to_set(exclude_properties)
        else:
            self.exclude_properties = None

        # prevent this mapper from being constructed
        # while a configure_mappers() is occurring (and defer a
        # configure_mappers() until construction succeeds)
        with _CONFIGURE_MUTEX:
            cast("MapperEvents", self.dispatch._events)._new_mapper_instance(
                class_, self
            )
            self._configure_inheritance()
            self._configure_class_instrumentation()
            self._configure_properties()
            self._configure_polymorphic_setter()
            self._configure_pks()
            self.registry._flag_new_mapper(self)
            self._log("constructed")
            self._expire_memoizations()

        self.dispatch.after_mapper_constructed(self, self.class_)

    def _prefer_eager_defaults(self, dialect, table):
        if self.eager_defaults == "auto":
            if not table.implicit_returning:
                return False

            return (
                table in self._server_default_col_keys
                and dialect.insert_executemany_returning
            )
        else:
            return self.eager_defaults

    def _gen_cache_key(self, anon_map, bindparams):
        return (self,)

    # ### BEGIN
    # ATTRIBUTE DECLARATIONS START HERE

    is_mapper = True
    """Part of the inspection API."""

    represents_outer_join = False

    registry: _RegistryType

    @property
    def mapper(self) -> Mapper[_O]:
        """Part of the inspection API.

        Returns self.

        """
        return self

    @property
    def entity(self):
        r"""Part of the inspection API.

        Returns self.class\_.

        """
        return self.class_

    class_: Type[_O]
    """The class to which this :class:`_orm.Mapper` is mapped."""

    _identity_class: Type[_O]

    _delete_orphans: List[Tuple[str, Type[Any]]]
    _dependency_processors: List[DependencyProcessor]
    _memoized_values: Dict[Any, Callable[[], Any]]
    _inheriting_mappers: util.WeakSequence[Mapper[Any]]
    _all_tables: Set[TableClause]
    _polymorphic_attr_key: Optional[str]

    _pks_by_table: Dict[FromClause, OrderedSet[ColumnClause[Any]]]
    _cols_by_table: Dict[FromClause, OrderedSet[ColumnElement[Any]]]

    _props: util.OrderedDict[str, MapperProperty[Any]]
    _init_properties: Dict[str, MapperProperty[Any]]

    _columntoproperty: _ColumnMapping

    _set_polymorphic_identity: Optional[Callable[[InstanceState[_O]], None]]
    _validate_polymorphic_identity: Optional[
        Callable[[Mapper[_O], InstanceState[_O], _InstanceDict], None]
    ]

    tables: Sequence[TableClause]
    """A sequence containing the collection of :class:`_schema.Table`
    or :class:`_schema.TableClause` objects which this :class:`_orm.Mapper`
    is aware of.

    If the mapper is mapped to a :class:`_expression.Join`, or an
    :class:`_expression.Alias`
    representing a :class:`_expression.Select`, the individual
    :class:`_schema.Table`
    objects that comprise the full construct will be represented here.

    This is a *read only* attribute determined during mapper construction.
    Behavior is undefined if directly modified.

    """

    validators: util.immutabledict[str, Tuple[str, Dict[str, Any]]]
    """An immutable dictionary of attributes which have been decorated
    using the :func:`_orm.validates` decorator.

    The dictionary contains string attribute names as keys
    mapped to the actual validation method.

    """

    always_refresh: bool
    allow_partial_pks: bool
    version_id_col: Optional[ColumnElement[Any]]

    with_polymorphic: Optional[
        Tuple[
            Union[Literal["*"], Sequence[Union[Mapper[Any], Type[Any]]]],
            Optional[FromClause],
        ]
    ]

    version_id_generator: Optional[Union[Literal[False], Callable[[Any], Any]]]

    local_table: FromClause
    """The immediate :class:`_expression.FromClause` to which this
    :class:`_orm.Mapper` refers.

    Typically is an instance of :class:`_schema.Table`, may be any
    :class:`.FromClause`.

    The "local" table is the
    selectable that the :class:`_orm.Mapper` is directly responsible for
    managing from an attribute access and flush perspective.   For
    non-inheriting mappers, :attr:`.Mapper.local_table` will be the same
    as :attr:`.Mapper.persist_selectable`.  For inheriting mappers,
    :attr:`.Mapper.local_table` refers to the specific portion of
    :attr:`.Mapper.persist_selectable` that includes the columns to which
    this :class:`.Mapper` is loading/persisting, such as a particular
    :class:`.Table` within a join.

    .. seealso::

        :attr:`_orm.Mapper.persist_selectable`.

        :attr:`_orm.Mapper.selectable`.

    """

    persist_selectable: FromClause
    """The :class:`_expression.FromClause` to which this :class:`_orm.Mapper`
    is mapped.

    Typically is an instance of :class:`_schema.Table`, may be any
    :class:`.FromClause`.

    The :attr:`_orm.Mapper.persist_selectable` is similar to
    :attr:`.Mapper.local_table`, but represents the :class:`.FromClause` that
    represents the inheriting class hierarchy overall in an inheritance
    scenario.

    :attr.`.Mapper.persist_selectable` is also separate from the
    :attr:`.Mapper.selectable` attribute, the latter of which may be an
    alternate subquery used for selecting columns.
    :attr.`.Mapper.persist_selectable` is oriented towards columns that
    will be written on a persist operation.

    .. seealso::

        :attr:`_orm.Mapper.selectable`.

        :attr:`_orm.Mapper.local_table`.

    """

    inherits: Optional[Mapper[Any]]
    """References the :class:`_orm.Mapper` which this :class:`_orm.Mapper`
    inherits from, if any.

    """

    inherit_condition: Optional[ColumnElement[bool]]

    configured: bool = False
    """Represent ``True`` if this :class:`_orm.Mapper` has been configured.

    This is a *read only* attribute determined during mapper construction.
    Behavior is undefined if directly modified.

    .. seealso::

        :func:`.configure_mappers`.

    """

    concrete: bool
    """Represent ``True`` if this :class:`_orm.Mapper` is a concrete
    inheritance mapper.

    This is a *read only* attribute determined during mapper construction.
    Behavior is undefined if directly modified.

    """

    primary_key: Tuple[Column[Any], ...]
    """An iterable containing the collection of :class:`_schema.Column`
    objects
    which comprise the 'primary key' of the mapped table, from the
    perspective of this :class:`_orm.Mapper`.

    This list is against the selectable in
    :attr:`_orm.Mapper.persist_selectable`.
    In the case of inheriting mappers, some columns may be managed by a
    superclass mapper.  For example, in the case of a
    :class:`_expression.Join`, the
    primary key is determined by all of the primary key columns across all
    tables referenced by the :class:`_expression.Join`.

    The list is also not necessarily the same as the primary key column
    collection associated with the underlying tables; the :class:`_orm.Mapper`
    features a ``primary_key`` argument that can override what the
    :class:`_orm.Mapper` considers as primary key columns.

    This is a *read only* attribute determined during mapper construction.
    Behavior is undefined if directly modified.

    """

    class_manager: ClassManager[_O]
    """The :class:`.ClassManager` which maintains event listeners
    and class-bound descriptors for this :class:`_orm.Mapper`.

    This is a *read only* attribute determined during mapper construction.
    Behavior is undefined if directly modified.

    """

    single: bool
    """Represent ``True`` if this :class:`_orm.Mapper` is a single table
    inheritance mapper.

    :attr:`_orm.Mapper.local_table` will be ``None`` if this flag is set.

    This is a *read only* attribute determined during mapper construction.
    Behavior is undefined if directly modified.

    """

    non_primary: bool
    """Represent ``True`` if this :class:`_orm.Mapper` is a "non-primary"
    mapper, e.g. a mapper that is used only to select rows but not for
    persistence management.

    This is a *read only* attribute determined during mapper construction.
    Behavior is undefined if directly modified.

    """

    polymorphic_on: Optional[KeyedColumnElement[Any]]
    """The :class:`_schema.Column` or SQL expression specified as the
    ``polymorphic_on`` argument
    for this :class:`_orm.Mapper`, within an inheritance scenario.

    This attribute is normally a :class:`_schema.Column` instance but
    may also be an expression, such as one derived from
    :func:`.cast`.

    This is a *read only* attribute determined during mapper construction.
    Behavior is undefined if directly modified.

    """

    polymorphic_map: Dict[Any, Mapper[Any]]
    """A mapping of "polymorphic identity" identifiers mapped to
    :class:`_orm.Mapper` instances, within an inheritance scenario.

    The identifiers can be of any type which is comparable to the
    type of column represented by :attr:`_orm.Mapper.polymorphic_on`.

    An inheritance chain of mappers will all reference the same
    polymorphic map object.  The object is used to correlate incoming
    result rows to target mappers.

    This is a *read only* attribute determined during mapper construction.
    Behavior is undefined if directly modified.

    """

    polymorphic_identity: Optional[Any]
    """Represent an identifier which is matched against the
    :attr:`_orm.Mapper.polymorphic_on` column during result row loading.

    Used only with inheritance, this object can be of any type which is
    comparable to the type of column represented by
    :attr:`_orm.Mapper.polymorphic_on`.

    This is a *read only* attribute determined during mapper construction.
    Behavior is undefined if directly modified.

    """

    base_mapper: Mapper[Any]
    """The base-most :class:`_orm.Mapper` in an inheritance chain.

    In a non-inheriting scenario, this attribute will always be this
    :class:`_orm.Mapper`.   In an inheritance scenario, it references
    the :class:`_orm.Mapper` which is parent to all other :class:`_orm.Mapper`
    objects in the inheritance chain.

    This is a *read only* attribute determined during mapper construction.
    Behavior is undefined if directly modified.

    """

    columns: ReadOnlyColumnCollection[str, Column[Any]]
    """A collection of :class:`_schema.Column` or other scalar expression
    objects maintained by this :class:`_orm.Mapper`.

    The collection behaves the same as that of the ``c`` attribute on
    any :class:`_schema.Table` object,
    except that only those columns included in
    this mapping are present, and are keyed based on the attribute name
    defined in the mapping, not necessarily the ``key`` attribute of the
    :class:`_schema.Column` itself.   Additionally, scalar expressions mapped
    by :func:`.column_property` are also present here.

    This is a *read only* attribute determined during mapper construction.
    Behavior is undefined if directly modified.

    """

    c: ReadOnlyColumnCollection[str, Column[Any]]
    """A synonym for :attr:`_orm.Mapper.columns`."""

    @util.non_memoized_property
    @util.deprecated("1.3", "Use .persist_selectable")
    def mapped_table(self):
        return self.persist_selectable

    @util.memoized_property
    def _path_registry(self) -> CachingEntityRegistry:
        return PathRegistry.per_mapper(self)

    def _configure_inheritance(self):
        """Configure settings related to inheriting and/or inherited mappers
        being present."""

        # a set of all mappers which inherit from this one.
        self._inheriting_mappers = util.WeakSequence()

        if self.inherits:
            if not issubclass(self.class_, self.inherits.class_):
                raise sa_exc.ArgumentError(
                    "Class '%s' does not inherit from '%s'"
                    % (self.class_.__name__, self.inherits.class_.__name__)
                )

            self.dispatch._update(self.inherits.dispatch)

            if self.non_primary != self.inherits.non_primary:
                np = not self.non_primary and "primary" or "non-primary"
                raise sa_exc.ArgumentError(
                    "Inheritance of %s mapper for class '%s' is "
                    "only allowed from a %s mapper"
                    % (np, self.class_.__name__, np)
                )

            if self.single:
                self.persist_selectable = self.inherits.persist_selectable
            elif self.local_table is not self.inherits.local_table:
                if self.concrete:
                    self.persist_selectable = self.local_table
                    for mapper in self.iterate_to_root():
                        if mapper.polymorphic_on is not None:
                            mapper._requires_row_aliasing = True
                else:
                    if self.inherit_condition is None:
                        # figure out inherit condition from our table to the
                        # immediate table of the inherited mapper, not its
                        # full table which could pull in other stuff we don't
                        # want (allows test/inheritance.InheritTest4 to pass)
                        try:
                            self.inherit_condition = sql_util.join_condition(
                                self.inherits.local_table, self.local_table
                            )
                        except sa_exc.NoForeignKeysError as nfe:
                            assert self.inherits.local_table is not None
                            assert self.local_table is not None
                            raise sa_exc.NoForeignKeysError(
                                "Can't determine the inherit condition "
                                "between inherited table '%s' and "
                                "inheriting "
                                "table '%s'; tables have no "
                                "foreign key relationships established.  "
                                "Please ensure the inheriting table has "
                                "a foreign key relationship to the "
                                "inherited "
                                "table, or provide an "
                                "'on clause' using "
                                "the 'inherit_condition' mapper argument."
                                % (
                                    self.inherits.local_table.description,
                                    self.local_table.description,
                                )
                            ) from nfe
                        except sa_exc.AmbiguousForeignKeysError as afe:
                            assert self.inherits.local_table is not None
                            assert self.local_table is not None
                            raise sa_exc.AmbiguousForeignKeysError(
                                "Can't determine the inherit condition "
                                "between inherited table '%s' and "
                                "inheriting "
                                "table '%s'; tables have more than one "
                                "foreign key relationship established.  "
                                "Please specify the 'on clause' using "
                                "the 'inherit_condition' mapper argument."
                                % (
                                    self.inherits.local_table.description,
                                    self.local_table.description,
                                )
                            ) from afe
                    assert self.inherits.persist_selectable is not None
                    self.persist_selectable = sql.join(
                        self.inherits.persist_selectable,
                        self.local_table,
                        self.inherit_condition,
                    )

                    fks = util.to_set(self.inherit_foreign_keys)
                    self._inherits_equated_pairs = sql_util.criterion_as_pairs(
                        self.persist_selectable.onclause,
                        consider_as_foreign_keys=fks,
                    )
            else:
                self.persist_selectable = self.local_table

            if self.polymorphic_identity is None:
                self._identity_class = self.class_

                if (
                    not self.polymorphic_abstract
                    and self.inherits.base_mapper.polymorphic_on is not None
                ):
                    util.warn(
                        f"{self} does not indicate a 'polymorphic_identity', "
                        "yet is part of an inheritance hierarchy that has a "
                        f"'polymorphic_on' column of "
                        f"'{self.inherits.base_mapper.polymorphic_on}'. "
                        "If this is an intermediary class that should not be "
                        "instantiated, the class may either be left unmapped, "
                        "or may include the 'polymorphic_abstract=True' "
                        "parameter in its Mapper arguments. To leave the "
                        "class unmapped when using Declarative, set the "
                        "'__abstract__ = True' attribute on the class."
                    )
            elif self.concrete:
                self._identity_class = self.class_
            else:
                self._identity_class = self.inherits._identity_class

            if self.version_id_col is None:
                self.version_id_col = self.inherits.version_id_col
                self.version_id_generator = self.inherits.version_id_generator
            elif (
                self.inherits.version_id_col is not None
                and self.version_id_col is not self.inherits.version_id_col
            ):
                util.warn(
                    "Inheriting version_id_col '%s' does not match inherited "
                    "version_id_col '%s' and will not automatically populate "
                    "the inherited versioning column. "
                    "version_id_col should only be specified on "
                    "the base-most mapper that includes versioning."
                    % (
                        self.version_id_col.description,
                        self.inherits.version_id_col.description,
                    )
                )

            self.polymorphic_map = self.inherits.polymorphic_map
            self.batch = self.inherits.batch
            self.inherits._inheriting_mappers.append(self)
            self.base_mapper = self.inherits.base_mapper
            self.passive_updates = self.inherits.passive_updates
            self.passive_deletes = (
                self.inherits.passive_deletes or self.passive_deletes
            )
            self._all_tables = self.inherits._all_tables

            if self.polymorphic_identity is not None:
                if self.polymorphic_identity in self.polymorphic_map:
                    util.warn(
                        "Reassigning polymorphic association for identity %r "
                        "from %r to %r: Check for duplicate use of %r as "
                        "value for polymorphic_identity."
                        % (
                            self.polymorphic_identity,
                            self.polymorphic_map[self.polymorphic_identity],
                            self,
                            self.polymorphic_identity,
                        )
                    )
                self.polymorphic_map[self.polymorphic_identity] = self

            if self.polymorphic_load and self.concrete:
                raise sa_exc.ArgumentError(
                    "polymorphic_load is not currently supported "
                    "with concrete table inheritance"
                )
            if self.polymorphic_load == "inline":
                self.inherits._add_with_polymorphic_subclass(self)
            elif self.polymorphic_load == "selectin":
                pass
            elif self.polymorphic_load is not None:
                raise sa_exc.ArgumentError(
                    "unknown argument for polymorphic_load: %r"
                    % self.polymorphic_load
                )

        else:
            self._all_tables = set()
            self.base_mapper = self
            assert self.local_table is not None
            self.persist_selectable = self.local_table
            if self.polymorphic_identity is not None:
                self.polymorphic_map[self.polymorphic_identity] = self
            self._identity_class = self.class_

        if self.persist_selectable is None:
            raise sa_exc.ArgumentError(
                "Mapper '%s' does not have a persist_selectable specified."
                % self
            )

    def _set_with_polymorphic(
        self, with_polymorphic: Optional[_WithPolymorphicArg]
    ) -> None:
        if with_polymorphic == "*":
            self.with_polymorphic = ("*", None)
        elif isinstance(with_polymorphic, (tuple, list)):
            if isinstance(with_polymorphic[0], (str, tuple, list)):
                self.with_polymorphic = cast(
                    """Tuple[
                        Union[
                            Literal["*"],
                            Sequence[Union["Mapper[Any]", Type[Any]]],
                        ],
                        Optional["FromClause"],
                    ]""",
                    with_polymorphic,
                )
            else:
                self.with_polymorphic = (with_polymorphic, None)
        elif with_polymorphic is not None:
            raise sa_exc.ArgumentError(
                f"Invalid setting for with_polymorphic: {with_polymorphic!r}"
            )
        else:
            self.with_polymorphic = None

        if self.with_polymorphic and self.with_polymorphic[1] is not None:
            self.with_polymorphic = (
                self.with_polymorphic[0],
                coercions.expect(
                    roles.StrictFromClauseRole,
                    self.with_polymorphic[1],
                    allow_select=True,
                ),
            )

        if self.configured:
            self._expire_memoizations()

    def _add_with_polymorphic_subclass(self, mapper):
        subcl = mapper.class_
        if self.with_polymorphic is None:
            self._set_with_polymorphic((subcl,))
        elif self.with_polymorphic[0] != "*":
            assert isinstance(self.with_polymorphic[0], tuple)
            self._set_with_polymorphic(
                (self.with_polymorphic[0] + (subcl,), self.with_polymorphic[1])
            )

    def _set_concrete_base(self, mapper):
        """Set the given :class:`_orm.Mapper` as the 'inherits' for this
        :class:`_orm.Mapper`, assuming this :class:`_orm.Mapper` is concrete
        and does not already have an inherits."""

        assert self.concrete
        assert not self.inherits
        assert isinstance(mapper, Mapper)
        self.inherits = mapper
        self.inherits.polymorphic_map.update(self.polymorphic_map)
        self.polymorphic_map = self.inherits.polymorphic_map
        for mapper in self.iterate_to_root():
            if mapper.polymorphic_on is not None:
                mapper._requires_row_aliasing = True
        self.batch = self.inherits.batch
        for mp in self.self_and_descendants:
            mp.base_mapper = self.inherits.base_mapper
        self.inherits._inheriting_mappers.append(self)
        self.passive_updates = self.inherits.passive_updates
        self._all_tables = self.inherits._all_tables

        for key, prop in mapper._props.items():
            if key not in self._props and not self._should_exclude(
                key, key, local=False, column=None
            ):
                self._adapt_inherited_property(key, prop, False)

    def _set_polymorphic_on(self, polymorphic_on):
        self.polymorphic_on = polymorphic_on
        self._configure_polymorphic_setter(True)

    def _configure_class_instrumentation(self):
        """If this mapper is to be a primary mapper (i.e. the
        non_primary flag is not set), associate this Mapper with the
        given class and entity name.

        Subsequent calls to ``class_mapper()`` for the ``class_`` / ``entity``
        name combination will return this mapper.  Also decorate the
        `__init__` method on the mapped class to include optional
        auto-session attachment logic.

        """

        # we expect that declarative has applied the class manager
        # already and set up a registry.  if this is None,
        # this raises as of 2.0.
        manager = attributes.opt_manager_of_class(self.class_)

        if self.non_primary:
            if not manager or not manager.is_mapped:
                raise sa_exc.InvalidRequestError(
                    "Class %s has no primary mapper configured.  Configure "
                    "a primary mapper first before setting up a non primary "
                    "Mapper." % self.class_
                )
            self.class_manager = manager

            assert manager.registry is not None
            self.registry = manager.registry
            self._identity_class = manager.mapper._identity_class
            manager.registry._add_non_primary_mapper(self)
            return

        if manager is None or not manager.registry:
            raise sa_exc.InvalidRequestError(
                "The _mapper() function and Mapper() constructor may not be "
                "invoked directly outside of a declarative registry."
                " Please use the sqlalchemy.orm.registry.map_imperatively() "
                "function for a classical mapping."
            )

        self.dispatch.instrument_class(self, self.class_)

        # this invokes the class_instrument event and sets up
        # the __init__ method.  documented behavior is that this must
        # occur after the instrument_class event above.
        # yes two events with the same two words reversed and different APIs.
        # :(

        manager = instrumentation.register_class(
            self.class_,
            mapper=self,
            expired_attribute_loader=util.partial(
                loading.load_scalar_attributes, self
            ),
            # finalize flag means instrument the __init__ method
            # and call the class_instrument event
            finalize=True,
        )

        self.class_manager = manager

        assert manager.registry is not None
        self.registry = manager.registry

        # The remaining members can be added by any mapper,
        # e_name None or not.
        if manager.mapper is None:
            return

        event.listen(manager, "init", _event_on_init, raw=True)

        for key, method in util.iterate_attributes(self.class_):
            if key == "__init__" and hasattr(method, "_sa_original_init"):
                method = method._sa_original_init
                if hasattr(method, "__func__"):
                    method = method.__func__
            if callable(method):
                if hasattr(method, "__sa_reconstructor__"):
                    self._reconstructor = method
                    event.listen(manager, "load", _event_on_load, raw=True)
                elif hasattr(method, "__sa_validators__"):
                    validation_opts = method.__sa_validation_opts__
                    for name in method.__sa_validators__:
                        if name in self.validators:
                            raise sa_exc.InvalidRequestError(
                                "A validation function for mapped "
                                "attribute %r on mapper %s already exists."
                                % (name, self)
                            )
                        self.validators = self.validators.union(
                            {name: (method, validation_opts)}
                        )

    def _set_dispose_flags(self) -> None:
        self.configured = True
        self._ready_for_configure = True
        self._dispose_called = True

        self.__dict__.pop("_configure_failed", None)

    def _str_arg_to_mapped_col(self, argname: str, key: str) -> Column[Any]:
        try:
            prop = self._props[key]
        except KeyError as err:
            raise sa_exc.ArgumentError(
                f"Can't determine {argname} column '{key}' - "
                "no attribute is mapped to this name."
            ) from err
        try:
            expr = prop.expression
        except AttributeError as ae:
            raise sa_exc.ArgumentError(
                f"Can't determine {argname} column '{key}'; "
                "property does not refer to a single mapped Column"
            ) from ae
        if not isinstance(expr, Column):
            raise sa_exc.ArgumentError(
                f"Can't determine {argname} column '{key}'; "
                "property does not refer to a single "
                "mapped Column"
            )
        return expr

    def _configure_pks(self) -> None:
        self.tables = sql_util.find_tables(self.persist_selectable)

        self._all_tables.update(t for t in self.tables)

        self._pks_by_table = {}
        self._cols_by_table = {}

        all_cols = util.column_set(
            chain(*[col.proxy_set for col in self._columntoproperty])
        )

        pk_cols = util.column_set(c for c in all_cols if c.primary_key)

        # identify primary key columns which are also mapped by this mapper.
        for fc in set(self.tables).union([self.persist_selectable]):
            if fc.primary_key and pk_cols.issuperset(fc.primary_key):
                # ordering is important since it determines the ordering of
                # mapper.primary_key (and therefore query.get())
                self._pks_by_table[fc] = util.ordered_column_set(  # type: ignore  # noqa: E501
                    fc.primary_key
                ).intersection(
                    pk_cols
                )
            self._cols_by_table[fc] = util.ordered_column_set(fc.c).intersection(  # type: ignore  # noqa: E501
                all_cols
            )

        if self._primary_key_argument:
            coerced_pk_arg = [
                self._str_arg_to_mapped_col("primary_key", c)
                if isinstance(c, str)
                else c
                for c in (
                    coercions.expect(
                        roles.DDLConstraintColumnRole,
                        coerce_pk,
                        argname="primary_key",
                    )
                    for coerce_pk in self._primary_key_argument
                )
            ]
        else:
            coerced_pk_arg = None

        # if explicit PK argument sent, add those columns to the
        # primary key mappings
        if coerced_pk_arg:
            for k in coerced_pk_arg:
                if k.table not in self._pks_by_table:
                    self._pks_by_table[k.table] = util.OrderedSet()
                self._pks_by_table[k.table].add(k)

        # otherwise, see that we got a full PK for the mapped table
        elif (
            self.persist_selectable not in self._pks_by_table
            or len(self._pks_by_table[self.persist_selectable]) == 0
        ):
            raise sa_exc.ArgumentError(
                "Mapper %s could not assemble any primary "
                "key columns for mapped table '%s'"
                % (self, self.persist_selectable.description)
            )
        elif self.local_table not in self._pks_by_table and isinstance(
            self.local_table, schema.Table
        ):
            util.warn(
                "Could not assemble any primary "
                "keys for locally mapped table '%s' - "
                "no rows will be persisted in this Table."
                % self.local_table.description
            )

        if (
            self.inherits
            and not self.concrete
            and not self._primary_key_argument
        ):
            # if inheriting, the "primary key" for this mapper is
            # that of the inheriting (unless concrete or explicit)
            self.primary_key = self.inherits.primary_key
        else:
            # determine primary key from argument or persist_selectable pks
            primary_key: Collection[ColumnElement[Any]]

            if coerced_pk_arg:
                primary_key = [
                    cc if cc is not None else c
                    for cc, c in (
                        (self.persist_selectable.corresponding_column(c), c)
                        for c in coerced_pk_arg
                    )
                ]
            else:
                # if heuristically determined PKs, reduce to the minimal set
                # of columns by eliminating FK->PK pairs for a multi-table
                # expression.   May over-reduce for some kinds of UNIONs
                # / CTEs; use explicit PK argument for these special cases
                primary_key = sql_util.reduce_columns(
                    self._pks_by_table[self.persist_selectable],
                    ignore_nonexistent_tables=True,
                )

            if len(primary_key) == 0:
                raise sa_exc.ArgumentError(
                    "Mapper %s could not assemble any primary "
                    "key columns for mapped table '%s'"
                    % (self, self.persist_selectable.description)
                )

            self.primary_key = tuple(primary_key)
            self._log("Identified primary key columns: %s", primary_key)

        # determine cols that aren't expressed within our tables; mark these
        # as "read only" properties which are refreshed upon INSERT/UPDATE
        self._readonly_props = {
            self._columntoproperty[col]
            for col in self._columntoproperty
            if self._columntoproperty[col] not in self._identity_key_props
            and (
                not hasattr(col, "table")
                or col.table not in self._cols_by_table
            )
        }

    def _configure_properties(self) -> None:
        self.columns = self.c = sql_base.ColumnCollection()  # type: ignore

        # object attribute names mapped to MapperProperty objects
        self._props = util.OrderedDict()

        # table columns mapped to MapperProperty
        self._columntoproperty = _ColumnMapping(self)

        explicit_col_props_by_column: Dict[
            KeyedColumnElement[Any], Tuple[str, ColumnProperty[Any]]
        ] = {}
        explicit_col_props_by_key: Dict[str, ColumnProperty[Any]] = {}

        # step 1: go through properties that were explicitly passed
        # in the properties dictionary.  For Columns that are local, put them
        # aside in a separate collection we will reconcile with the Table
        # that's given.  For other properties, set them up in _props now.
        if self._init_properties:
            for key, prop_arg in self._init_properties.items():
                if not isinstance(prop_arg, MapperProperty):
                    possible_col_prop = self._make_prop_from_column(
                        key, prop_arg
                    )
                else:
                    possible_col_prop = prop_arg

                # issue #8705.  if the explicit property is actually a
                # Column that is local to the local Table, don't set it up
                # in ._props yet, integrate it into the order given within
                # the Table.

                _map_as_property_now = True
                if isinstance(possible_col_prop, properties.ColumnProperty):
                    for given_col in possible_col_prop.columns:
                        if self.local_table.c.contains_column(given_col):
                            _map_as_property_now = False
                            explicit_col_props_by_key[key] = possible_col_prop
                            explicit_col_props_by_column[given_col] = (
                                key,
                                possible_col_prop,
                            )

                if _map_as_property_now:
                    self._configure_property(
                        key,
                        possible_col_prop,
                        init=False,
                    )

        # step 2: pull properties from the inherited mapper.  reconcile
        # columns with those which are explicit above.  for properties that
        # are only in the inheriting mapper, set them up as local props
        if self.inherits:
            for key, inherited_prop in self.inherits._props.items():
                if self._should_exclude(key, key, local=False, column=None):
                    continue

                incoming_prop = explicit_col_props_by_key.get(key)
                if incoming_prop:
                    new_prop = self._reconcile_prop_with_incoming_columns(
                        key,
                        inherited_prop,
                        warn_only=False,
                        incoming_prop=incoming_prop,
                    )
                    explicit_col_props_by_key[key] = new_prop

                    for inc_col in incoming_prop.columns:
                        explicit_col_props_by_column[inc_col] = (
                            key,
                            new_prop,
                        )
                elif key not in self._props:
                    self._adapt_inherited_property(key, inherited_prop, False)

        # step 3.  Iterate through all columns in the persist selectable.
        # this includes not only columns in the local table / fromclause,
        # but also those columns in the superclass table if we are joined
        # inh or single inh mapper.  map these columns as well. additional
        # reconciliation against inherited columns occurs here also.

        for column in self.persist_selectable.columns:
            if column in explicit_col_props_by_column:
                # column was explicitly passed to properties; configure
                # it now in the order in which it corresponds to the
                # Table / selectable
                key, prop = explicit_col_props_by_column[column]
                self._configure_property(key, prop, init=False)
                continue

            elif column in self._columntoproperty:
                continue

            column_key = (self.column_prefix or "") + column.key
            if self._should_exclude(
                column.key,
                column_key,
                local=self.local_table.c.contains_column(column),
                column=column,
            ):
                continue

            # adjust the "key" used for this column to that
            # of the inheriting mapper
            for mapper in self.iterate_to_root():
                if column in mapper._columntoproperty:
                    column_key = mapper._columntoproperty[column].key

            self._configure_property(
                column_key,
                column,
                init=False,
                setparent=True,
            )

    def _configure_polymorphic_setter(self, init=False):
        """Configure an attribute on the mapper representing the
        'polymorphic_on' column, if applicable, and not
        already generated by _configure_properties (which is typical).

        Also create a setter function which will assign this
        attribute to the value of the 'polymorphic_identity'
        upon instance construction, also if applicable.  This
        routine will run when an instance is created.

        """
        setter = False
        polymorphic_key: Optional[str] = None

        if self.polymorphic_on is not None:
            setter = True

            if isinstance(self.polymorphic_on, str):
                # polymorphic_on specified as a string - link
                # it to mapped ColumnProperty
                try:
                    self.polymorphic_on = self._props[self.polymorphic_on]
                except KeyError as err:
                    raise sa_exc.ArgumentError(
                        "Can't determine polymorphic_on "
                        "value '%s' - no attribute is "
                        "mapped to this name." % self.polymorphic_on
                    ) from err

            if self.polymorphic_on in self._columntoproperty:
                # polymorphic_on is a column that is already mapped
                # to a ColumnProperty
                prop = self._columntoproperty[self.polymorphic_on]
            elif isinstance(self.polymorphic_on, MapperProperty):
                # polymorphic_on is directly a MapperProperty,
                # ensure it's a ColumnProperty
                if not isinstance(
                    self.polymorphic_on, properties.ColumnProperty
                ):
                    raise sa_exc.ArgumentError(
                        "Only direct column-mapped "
                        "property or SQL expression "
                        "can be passed for polymorphic_on"
                    )
                prop = self.polymorphic_on
            else:
                # polymorphic_on is a Column or SQL expression and
                # doesn't appear to be mapped. this means it can be 1.
                # only present in the with_polymorphic selectable or
                # 2. a totally standalone SQL expression which we'd
                # hope is compatible with this mapper's persist_selectable
                col = self.persist_selectable.corresponding_column(
                    self.polymorphic_on
                )
                if col is None:
                    # polymorphic_on doesn't derive from any
                    # column/expression isn't present in the mapped
                    # table. we will make a "hidden" ColumnProperty
                    # for it. Just check that if it's directly a
                    # schema.Column and we have with_polymorphic, it's
                    # likely a user error if the schema.Column isn't
                    # represented somehow in either persist_selectable or
                    # with_polymorphic.   Otherwise as of 0.7.4 we
                    # just go with it and assume the user wants it
                    # that way (i.e. a CASE statement)
                    setter = False
                    instrument = False
                    col = self.polymorphic_on
                    if isinstance(col, schema.Column) and (
                        self.with_polymorphic is None
                        or self.with_polymorphic[1] is None
                        or self.with_polymorphic[1].corresponding_column(col)
                        is None
                    ):
                        raise sa_exc.InvalidRequestError(
                            "Could not map polymorphic_on column "
                            "'%s' to the mapped table - polymorphic "
                            "loads will not function properly"
                            % col.description
                        )
                else:
                    # column/expression that polymorphic_on derives from
                    # is present in our mapped table
                    # and is probably mapped, but polymorphic_on itself
                    # is not.  This happens when
                    # the polymorphic_on is only directly present in the
                    # with_polymorphic selectable, as when use
                    # polymorphic_union.
                    # we'll make a separate ColumnProperty for it.
                    instrument = True
                key = getattr(col, "key", None)
                if key:
                    if self._should_exclude(key, key, False, col):
                        raise sa_exc.InvalidRequestError(
                            "Cannot exclude or override the "
                            "discriminator column %r" % key
                        )
                else:
                    self.polymorphic_on = col = col.label("_sa_polymorphic_on")
                    key = col.key

                prop = properties.ColumnProperty(col, _instrument=instrument)
                self._configure_property(key, prop, init=init, setparent=True)

            # the actual polymorphic_on should be the first public-facing
            # column in the property
            self.polymorphic_on = prop.columns[0]
            polymorphic_key = prop.key
        else:
            # no polymorphic_on was set.
            # check inheriting mappers for one.
            for mapper in self.iterate_to_root():
                # determine if polymorphic_on of the parent
                # should be propagated here.   If the col
                # is present in our mapped table, or if our mapped
                # table is the same as the parent (i.e. single table
                # inheritance), we can use it
                if mapper.polymorphic_on is not None:
                    if self.persist_selectable is mapper.persist_selectable:
                        self.polymorphic_on = mapper.polymorphic_on
                    else:
                        self.polymorphic_on = (
                            self.persist_selectable
                        ).corresponding_column(mapper.polymorphic_on)
                    # we can use the parent mapper's _set_polymorphic_identity
                    # directly; it ensures the polymorphic_identity of the
                    # instance's mapper is used so is portable to subclasses.
                    if self.polymorphic_on is not None:
                        self._set_polymorphic_identity = (
                            mapper._set_polymorphic_identity
                        )
                        self._polymorphic_attr_key = (
                            mapper._polymorphic_attr_key
                        )
                        self._validate_polymorphic_identity = (
                            mapper._validate_polymorphic_identity
                        )
                    else:
                        self._set_polymorphic_identity = None
                        self._polymorphic_attr_key = None
                    return

        if self.polymorphic_abstract and self.polymorphic_on is None:
            raise sa_exc.InvalidRequestError(
                "The Mapper.polymorphic_abstract parameter may only be used "
                "on a mapper hierarchy which includes the "
                "Mapper.polymorphic_on parameter at the base of the hierarchy."
            )

        if setter:

            def _set_polymorphic_identity(state):
                dict_ = state.dict
                # TODO: what happens if polymorphic_on column attribute name
                # does not match .key?

                polymorphic_identity = (
                    state.manager.mapper.polymorphic_identity
                )
                if (
                    polymorphic_identity is None
                    and state.manager.mapper.polymorphic_abstract
                ):
                    raise sa_exc.InvalidRequestError(
                        f"Can't instantiate class for {state.manager.mapper}; "
                        "mapper is marked polymorphic_abstract=True"
                    )

                state.get_impl(polymorphic_key).set(
                    state,
                    dict_,
                    polymorphic_identity,
                    None,
                )

            self._polymorphic_attr_key = polymorphic_key

            def _validate_polymorphic_identity(mapper, state, dict_):
                if (
                    polymorphic_key in dict_
                    and dict_[polymorphic_key]
                    not in mapper._acceptable_polymorphic_identities
                ):
                    util.warn_limited(
                        "Flushing object %s with "
                        "incompatible polymorphic identity %r; the "
                        "object may not refresh and/or load correctly",
                        (state_str(state), dict_[polymorphic_key]),
                    )

            self._set_polymorphic_identity = _set_polymorphic_identity
            self._validate_polymorphic_identity = (
                _validate_polymorphic_identity
            )
        else:
            self._polymorphic_attr_key = None
            self._set_polymorphic_identity = None

    _validate_polymorphic_identity = None

    @HasMemoized.memoized_attribute
    def _version_id_prop(self):
        if self.version_id_col is not None:
            return self._columntoproperty[self.version_id_col]
        else:
            return None

    @HasMemoized.memoized_attribute
    def _acceptable_polymorphic_identities(self):
        identities = set()

        stack = deque([self])
        while stack:
            item = stack.popleft()
            if item.persist_selectable is self.persist_selectable:
                identities.add(item.polymorphic_identity)
                stack.extend(item._inheriting_mappers)

        return identities

    @HasMemoized.memoized_attribute
    def _prop_set(self):
        return frozenset(self._props.values())

    @util.preload_module("sqlalchemy.orm.descriptor_props")
    def _adapt_inherited_property(self, key, prop, init):
        descriptor_props = util.preloaded.orm_descriptor_props

        if not self.concrete:
            self._configure_property(key, prop, init=False, setparent=False)
        elif key not in self._props:
            # determine if the class implements this attribute; if not,
            # or if it is implemented by the attribute that is handling the
            # given superclass-mapped property, then we need to report that we
            # can't use this at the instance level since we are a concrete
            # mapper and we don't map this.  don't trip user-defined
            # descriptors that might have side effects when invoked.
            implementing_attribute = self.class_manager._get_class_attr_mro(
                key, prop
            )
            if implementing_attribute is prop or (
                isinstance(
                    implementing_attribute, attributes.InstrumentedAttribute
                )
                and implementing_attribute._parententity is prop.parent
            ):
                self._configure_property(
                    key,
                    descriptor_props.ConcreteInheritedProperty(),
                    init=init,
                    setparent=True,
                )

    @util.preload_module("sqlalchemy.orm.descriptor_props")
    def _configure_property(
        self,
        key: str,
        prop_arg: Union[KeyedColumnElement[Any], MapperProperty[Any]],
        *,
        init: bool = True,
        setparent: bool = True,
        warn_for_existing: bool = False,
    ) -> MapperProperty[Any]:
        descriptor_props = util.preloaded.orm_descriptor_props
        self._log(
            "_configure_property(%s, %s)", key, prop_arg.__class__.__name__
        )

        if not isinstance(prop_arg, MapperProperty):
            prop: MapperProperty[Any] = self._property_from_column(
                key, prop_arg
            )
        else:
            prop = prop_arg

        if isinstance(prop, properties.ColumnProperty):
            col = self.persist_selectable.corresponding_column(prop.columns[0])

            # if the column is not present in the mapped table,
            # test if a column has been added after the fact to the
            # parent table (or their parent, etc.) [ticket:1570]
            if col is None and self.inherits:
                path = [self]
                for m in self.inherits.iterate_to_root():
                    col = m.local_table.corresponding_column(prop.columns[0])
                    if col is not None:
                        for m2 in path:
                            m2.persist_selectable._refresh_for_new_column(col)
                        col = self.persist_selectable.corresponding_column(
                            prop.columns[0]
                        )
                        break
                    path.append(m)

            # subquery expression, column not present in the mapped
            # selectable.
            if col is None:
                col = prop.columns[0]

                # column is coming in after _readonly_props was
                # initialized; check for 'readonly'
                if hasattr(self, "_readonly_props") and (
                    not hasattr(col, "table")
                    or col.table not in self._cols_by_table
                ):
                    self._readonly_props.add(prop)

            else:
                # if column is coming in after _cols_by_table was
                # initialized, ensure the col is in the right set
                if (
                    hasattr(self, "_cols_by_table")
                    and col.table in self._cols_by_table
                    and col not in self._cols_by_table[col.table]
                ):
                    self._cols_by_table[col.table].add(col)

            # if this properties.ColumnProperty represents the "polymorphic
            # discriminator" column, mark it.  We'll need this when rendering
            # columns in SELECT statements.
            if not hasattr(prop, "_is_polymorphic_discriminator"):
                prop._is_polymorphic_discriminator = (
                    col is self.polymorphic_on
                    or prop.columns[0] is self.polymorphic_on
                )

            if isinstance(col, expression.Label):
                # new in 1.4, get column property against expressions
                # to be addressable in subqueries
                col.key = col._tq_key_label = key

            self.columns.add(col, key)

            for col in prop.columns:
                for proxy_col in col.proxy_set:
                    self._columntoproperty[proxy_col] = prop

        if getattr(prop, "key", key) != key:
            util.warn(
                f"ORM mapped property {self.class_.__name__}.{prop.key} being "
                "assigned to attribute "
                f"{key!r} is already associated with "
                f"attribute {prop.key!r}. The attribute will be de-associated "
                f"from {prop.key!r}."
            )

        prop.key = key

        if setparent:
            prop.set_parent(self, init)

        if key in self._props and getattr(
            self._props[key], "_mapped_by_synonym", False
        ):
            syn = self._props[key]._mapped_by_synonym
            raise sa_exc.ArgumentError(
                "Can't call map_column=True for synonym %r=%r, "
                "a ColumnProperty already exists keyed to the name "
                "%r for column %r" % (syn, key, key, syn)
            )

        # replacement cases

        # case one: prop is replacing a prop that we have mapped.  this is
        # independent of whatever might be in the actual class dictionary
        if (
            key in self._props
            and not isinstance(
                self._props[key], descriptor_props.ConcreteInheritedProperty
            )
            and not isinstance(prop, descriptor_props.SynonymProperty)
        ):
            if warn_for_existing:
                util.warn_deprecated(
                    f"User-placed attribute {self.class_.__name__}.{key} on "
                    f"{self} is replacing an existing ORM-mapped attribute.  "
                    "Behavior is not fully defined in this case.  This "
                    "use is deprecated and will raise an error in a future "
                    "release",
                    "2.0",
                )
            oldprop = self._props[key]
            self._path_registry.pop(oldprop, None)

        # case two: prop is replacing an attribute on the class of some kind.
        # we have to be more careful here since it's normal when using
        # Declarative that all the "declared attributes" on the class
        # get replaced.
        elif (
            warn_for_existing
            and self.class_.__dict__.get(key, None) is not None
            and not isinstance(prop, descriptor_props.SynonymProperty)
            and not isinstance(
                self._props.get(key, None),
                descriptor_props.ConcreteInheritedProperty,
            )
        ):
            util.warn_deprecated(
                f"User-placed attribute {self.class_.__name__}.{key} on "
                f"{self} is replacing an existing class-bound "
                "attribute of the same name.  "
                "Behavior is not fully defined in this case.  This "
                "use is deprecated and will raise an error in a future "
                "release",
                "2.0",
            )

        self._props[key] = prop

        if not self.non_primary:
            prop.instrument_class(self)

        for mapper in self._inheriting_mappers:
            mapper._adapt_inherited_property(key, prop, init)

        if init:
            prop.init()
            prop.post_instrument_class(self)

        if self.configured:
            self._expire_memoizations()

        return prop

    def _make_prop_from_column(
        self,
        key: str,
        column: Union[
            Sequence[KeyedColumnElement[Any]], KeyedColumnElement[Any]
        ],
    ) -> ColumnProperty[Any]:
        columns = util.to_list(column)
        mapped_column = []
        for c in columns:
            mc = self.persist_selectable.corresponding_column(c)
            if mc is None:
                mc = self.local_table.corresponding_column(c)
                if mc is not None:
                    # if the column is in the local table but not the
                    # mapped table, this corresponds to adding a
                    # column after the fact to the local table.
                    # [ticket:1523]
                    self.persist_selectable._refresh_for_new_column(mc)
                mc = self.persist_selectable.corresponding_column(c)
                if mc is None:
                    raise sa_exc.ArgumentError(
                        "When configuring property '%s' on %s, "
                        "column '%s' is not represented in the mapper's "
                        "table. Use the `column_property()` function to "
                        "force this column to be mapped as a read-only "
                        "attribute." % (key, self, c)
                    )
            mapped_column.append(mc)
        return properties.ColumnProperty(*mapped_column)

    def _reconcile_prop_with_incoming_columns(
        self,
        key: str,
        existing_prop: MapperProperty[Any],
        warn_only: bool,
        incoming_prop: Optional[ColumnProperty[Any]] = None,
        single_column: Optional[KeyedColumnElement[Any]] = None,
    ) -> ColumnProperty[Any]:
        if incoming_prop and (
            self.concrete
            or not isinstance(existing_prop, properties.ColumnProperty)
        ):
            return incoming_prop

        existing_column = existing_prop.columns[0]

        if incoming_prop and existing_column in incoming_prop.columns:
            return incoming_prop

        if incoming_prop is None:
            assert single_column is not None
            incoming_column = single_column
            equated_pair_key = (existing_prop.columns[0], incoming_column)
        else:
            assert single_column is None
            incoming_column = incoming_prop.columns[0]
            equated_pair_key = (incoming_column, existing_prop.columns[0])

        if (
            (
                not self._inherits_equated_pairs
                or (equated_pair_key not in self._inherits_equated_pairs)
            )
            and not existing_column.shares_lineage(incoming_column)
            and existing_column is not self.version_id_col
            and incoming_column is not self.version_id_col
        ):
            msg = (
                "Implicitly combining column %s with column "
                "%s under attribute '%s'.  Please configure one "
                "or more attributes for these same-named columns "
                "explicitly."
                % (
                    existing_prop.columns[-1],
                    incoming_column,
                    key,
                )
            )
            if warn_only:
                util.warn(msg)
            else:
                raise sa_exc.InvalidRequestError(msg)

        # existing properties.ColumnProperty from an inheriting
        # mapper. make a copy and append our column to it
        # breakpoint()
        new_prop = existing_prop.copy()

        new_prop.columns.insert(0, incoming_column)
        self._log(
            "inserting column to existing list "
            "in properties.ColumnProperty %s",
            key,
        )
        return new_prop  # type: ignore

    @util.preload_module("sqlalchemy.orm.descriptor_props")
    def _property_from_column(
        self,
        key: str,
        column: KeyedColumnElement[Any],
    ) -> ColumnProperty[Any]:
        """generate/update a :class:`.ColumnProperty` given a
        :class:`_schema.Column` or other SQL expression object."""

        descriptor_props = util.preloaded.orm_descriptor_props

        prop = self._props.get(key)

        if isinstance(prop, properties.ColumnProperty):
            return self._reconcile_prop_with_incoming_columns(
                key,
                prop,
                single_column=column,
                warn_only=prop.parent is not self,
            )
        elif prop is None or isinstance(
            prop, descriptor_props.ConcreteInheritedProperty
        ):
            return self._make_prop_from_column(key, column)
        else:
            raise sa_exc.ArgumentError(
                "WARNING: when configuring property '%s' on %s, "
                "column '%s' conflicts with property '%r'. "
                "To resolve this, map the column to the class under a "
                "different name in the 'properties' dictionary.  Or, "
                "to remove all awareness of the column entirely "
                "(including its availability as a foreign key), "
                "use the 'include_properties' or 'exclude_properties' "
                "mapper arguments to control specifically which table "
                "columns get mapped." % (key, self, column.key, prop)
            )

    @util.langhelpers.tag_method_for_warnings(
        "This warning originated from the `configure_mappers()` process, "
        "which was invoked automatically in response to a user-initiated "
        "operation.",
        sa_exc.SAWarning,
    )
    def _check_configure(self) -> None:
        if self.registry._new_mappers:
            _configure_registries({self.registry}, cascade=True)

    def _post_configure_properties(self) -> None:
        """Call the ``init()`` method on all ``MapperProperties``
        attached to this mapper.

        This is a deferred configuration step which is intended
        to execute once all mappers have been constructed.

        """

        self._log("_post_configure_properties() started")
        l = [(key, prop) for key, prop in self._props.items()]
        for key, prop in l:
            self._log("initialize prop %s", key)

            if prop.parent is self and not prop._configure_started:
                prop.init()

            if prop._configure_finished:
                prop.post_instrument_class(self)

        self._log("_post_configure_properties() complete")
        self.configured = True

    def add_properties(self, dict_of_properties):
        """Add the given dictionary of properties to this mapper,
        using `add_property`.

        """
        for key, value in dict_of_properties.items():
            self.add_property(key, value)

    def add_property(
        self, key: str, prop: Union[Column[Any], MapperProperty[Any]]
    ) -> None:
        """Add an individual MapperProperty to this mapper.

        If the mapper has not been configured yet, just adds the
        property to the initial properties dictionary sent to the
        constructor.  If this Mapper has already been configured, then
        the given MapperProperty is configured immediately.

        """
        prop = self._configure_property(
            key, prop, init=self.configured, warn_for_existing=True
        )
        assert isinstance(prop, MapperProperty)
        self._init_properties[key] = prop

    def _expire_memoizations(self) -> None:
        for mapper in self.iterate_to_root():
            mapper._reset_memoizations()

    @property
    def _log_desc(self) -> str:
        return (
            "("
            + self.class_.__name__
            + "|"
            + (
                self.local_table is not None
                and self.local_table.description
                or str(self.local_table)
            )
            + (self.non_primary and "|non-primary" or "")
            + ")"
        )

    def _log(self, msg: str, *args: Any) -> None:
        self.logger.info("%s " + msg, *((self._log_desc,) + args))

    def _log_debug(self, msg: str, *args: Any) -> None:
        self.logger.debug("%s " + msg, *((self._log_desc,) + args))

    def __repr__(self) -> str:
        return "<Mapper at 0x%x; %s>" % (id(self), self.class_.__name__)

    def __str__(self) -> str:
        return "Mapper[%s%s(%s)]" % (
            self.class_.__name__,
            self.non_primary and " (non-primary)" or "",
            self.local_table.description
            if self.local_table is not None
            else self.persist_selectable.description,
        )

    def _is_orphan(self, state: InstanceState[_O]) -> bool:
        orphan_possible = False
        for mapper in self.iterate_to_root():
            for key, cls in mapper._delete_orphans:
                orphan_possible = True

                has_parent = attributes.manager_of_class(cls).has_parent(
                    state, key, optimistic=state.has_identity
                )

                if self.legacy_is_orphan and has_parent:
                    return False
                elif not self.legacy_is_orphan and not has_parent:
                    return True

        if self.legacy_is_orphan:
            return orphan_possible
        else:
            return False

    def has_property(self, key: str) -> bool:
        return key in self._props

    def get_property(
        self, key: str, _configure_mappers: bool = False
    ) -> MapperProperty[Any]:
        """return a MapperProperty associated with the given key."""

        if _configure_mappers:
            self._check_configure()

        try:
            return self._props[key]
        except KeyError as err:
            raise sa_exc.InvalidRequestError(
                f"Mapper '{self}' has no property '{key}'.  If this property "
                "was indicated from other mappers or configure events, ensure "
                "registry.configure() has been called."
            ) from err

    def get_property_by_column(
        self, column: ColumnElement[_T]
    ) -> MapperProperty[_T]:
        """Given a :class:`_schema.Column` object, return the
        :class:`.MapperProperty` which maps this column."""

        return self._columntoproperty[column]

    @property
    def iterate_properties(self):
        """return an iterator of all MapperProperty objects."""

        return iter(self._props.values())

    def _mappers_from_spec(
        self, spec: Any, selectable: Optional[FromClause]
    ) -> Sequence[Mapper[Any]]:
        """given a with_polymorphic() argument, return the set of mappers it
        represents.

        Trims the list of mappers to just those represented within the given
        selectable, if present. This helps some more legacy-ish mappings.

        """
        if spec == "*":
            mappers = list(self.self_and_descendants)
        elif spec:
            mapper_set = set()
            for m in util.to_list(spec):
                m = _class_to_mapper(m)
                if not m.isa(self):
                    raise sa_exc.InvalidRequestError(
                        "%r does not inherit from %r" % (m, self)
                    )

                if selectable is None:
                    mapper_set.update(m.iterate_to_root())
                else:
                    mapper_set.add(m)
            mappers = [m for m in self.self_and_descendants if m in mapper_set]
        else:
            mappers = []

        if selectable is not None:
            tables = set(
                sql_util.find_tables(selectable, include_aliases=True)
            )
            mappers = [m for m in mappers if m.local_table in tables]
        return mappers

    def _selectable_from_mappers(
        self, mappers: Iterable[Mapper[Any]], innerjoin: bool
    ) -> FromClause:
        """given a list of mappers (assumed to be within this mapper's
        inheritance hierarchy), construct an outerjoin amongst those mapper's
        mapped tables.

        """
        from_obj = self.persist_selectable
        for m in mappers:
            if m is self:
                continue
            if m.concrete:
                raise sa_exc.InvalidRequestError(
                    "'with_polymorphic()' requires 'selectable' argument "
                    "when concrete-inheriting mappers are used."
                )
            elif not m.single:
                if innerjoin:
                    from_obj = from_obj.join(
                        m.local_table, m.inherit_condition
                    )
                else:
                    from_obj = from_obj.outerjoin(
                        m.local_table, m.inherit_condition
                    )

        return from_obj

    @HasMemoized.memoized_attribute
    def _version_id_has_server_side_value(self) -> bool:
        vid_col = self.version_id_col

        if vid_col is None:
            return False

        elif not isinstance(vid_col, Column):
            return True
        else:
            return vid_col.server_default is not None or (
                vid_col.default is not None
                and (
                    not vid_col.default.is_scalar
                    and not vid_col.default.is_callable
                )
            )

    @HasMemoized.memoized_attribute
    def _single_table_criterion(self):
        if self.single and self.inherits and self.polymorphic_on is not None:
            return self.polymorphic_on._annotate(
                {"parententity": self, "parentmapper": self}
            ).in_(
                [
                    m.polymorphic_identity
                    for m in self.self_and_descendants
                    if not m.polymorphic_abstract
                ]
            )
        else:
            return None

    @HasMemoized.memoized_attribute
    def _has_aliased_polymorphic_fromclause(self):
        """return True if with_polymorphic[1] is an aliased fromclause,
        like a subquery.

        As of #8168, polymorphic adaption with ORMAdapter is used only
        if this is present.

        """
        return self.with_polymorphic and isinstance(
            self.with_polymorphic[1],
            expression.AliasedReturnsRows,
        )

    @HasMemoized.memoized_attribute
    def _should_select_with_poly_adapter(self):
        """determine if _MapperEntity or _ORMColumnEntity will need to use
        polymorphic adaption when setting up a SELECT as well as fetching
        rows for mapped classes and subclasses against this Mapper.

        moved here from context.py for #8456 to generalize the ruleset
        for this condition.

        """

        # this has been simplified as of #8456.
        # rule is: if we have a with_polymorphic or a concrete-style
        # polymorphic selectable, *or* if the base mapper has either of those,
        # we turn on the adaption thing.  if not, we do *no* adaption.
        #
        # (UPDATE for #8168: the above comment was not accurate, as we were
        # still saying "do polymorphic" if we were using an auto-generated
        # flattened JOIN for with_polymorphic.)
        #
        # this splits the behavior among the "regular" joined inheritance
        # and single inheritance mappers, vs. the "weird / difficult"
        # concrete and joined inh mappings that use a with_polymorphic of
        # some kind or polymorphic_union.
        #
        # note we have some tests in test_polymorphic_rel that query against
        # a subclass, then refer to the superclass that has a with_polymorphic
        # on it (such as test_join_from_polymorphic_explicit_aliased_three).
        # these tests actually adapt the polymorphic selectable (like, the
        # UNION or the SELECT subquery with JOIN in it) to be just the simple
        # subclass table.   Hence even if we are a "plain" inheriting mapper
        # but our base has a wpoly on it, we turn on adaption.  This is a
        # legacy case we should probably disable.
        #
        #
        # UPDATE: simplified way more as of #8168.   polymorphic adaption
        # is turned off even if with_polymorphic is set, as long as there
        # is no user-defined aliased selectable / subquery configured.
        # this scales back the use of polymorphic adaption in practice
        # to basically no cases except for concrete inheritance with a
        # polymorphic base class.
        #
        return (
            self._has_aliased_polymorphic_fromclause
            or self._requires_row_aliasing
            or (self.base_mapper._has_aliased_polymorphic_fromclause)
            or self.base_mapper._requires_row_aliasing
        )

    @HasMemoized.memoized_attribute
    def _with_polymorphic_mappers(self) -> Sequence[Mapper[Any]]:
        self._check_configure()

        if not self.with_polymorphic:
            return []
        return self._mappers_from_spec(*self.with_polymorphic)

    @HasMemoized.memoized_attribute
    def _post_inspect(self):
        """This hook is invoked by attribute inspection.

        E.g. when Query calls:

            coercions.expect(roles.ColumnsClauseRole, ent, keep_inspect=True)

        This allows the inspection process run a configure mappers hook.

        """
        self._check_configure()

    @HasMemoized_ro_memoized_attribute
    def _with_polymorphic_selectable(self) -> FromClause:
        if not self.with_polymorphic:
            return self.persist_selectable

        spec, selectable = self.with_polymorphic
        if selectable is not None:
            return selectable
        else:
            return self._selectable_from_mappers(
                self._mappers_from_spec(spec, selectable), False
            )

    with_polymorphic_mappers = _with_polymorphic_mappers
    """The list of :class:`_orm.Mapper` objects included in the
    default "polymorphic" query.

    """

    @HasMemoized_ro_memoized_attribute
    def _insert_cols_evaluating_none(self):
        return {
            table: frozenset(
                col for col in columns if col.type.should_evaluate_none
            )
            for table, columns in self._cols_by_table.items()
        }

    @HasMemoized.memoized_attribute
    def _insert_cols_as_none(self):
        return {
            table: frozenset(
                col.key
                for col in columns
                if not col.primary_key
                and not col.server_default
                and not col.default
                and not col.type.should_evaluate_none
            )
            for table, columns in self._cols_by_table.items()
        }

    @HasMemoized.memoized_attribute
    def _propkey_to_col(self):
        return {
            table: {self._columntoproperty[col].key: col for col in columns}
            for table, columns in self._cols_by_table.items()
        }

    @HasMemoized.memoized_attribute
    def _pk_keys_by_table(self):
        return {
            table: frozenset([col.key for col in pks])
            for table, pks in self._pks_by_table.items()
        }

    @HasMemoized.memoized_attribute
    def _pk_attr_keys_by_table(self):
        return {
            table: frozenset([self._columntoproperty[col].key for col in pks])
            for table, pks in self._pks_by_table.items()
        }

    @HasMemoized.memoized_attribute
    def _server_default_cols(
        self,
    ) -> Mapping[FromClause, FrozenSet[Column[Any]]]:
        return {
            table: frozenset(
                [
                    col
                    for col in cast("Iterable[Column[Any]]", columns)
                    if col.server_default is not None
                    or (
                        col.default is not None
                        and col.default.is_clause_element
                    )
                ]
            )
            for table, columns in self._cols_by_table.items()
        }

    @HasMemoized.memoized_attribute
    def _server_onupdate_default_cols(
        self,
    ) -> Mapping[FromClause, FrozenSet[Column[Any]]]:
        return {
            table: frozenset(
                [
                    col
                    for col in cast("Iterable[Column[Any]]", columns)
                    if col.server_onupdate is not None
                    or (
                        col.onupdate is not None
                        and col.onupdate.is_clause_element
                    )
                ]
            )
            for table, columns in self._cols_by_table.items()
        }

    @HasMemoized.memoized_attribute
    def _server_default_col_keys(self) -> Mapping[FromClause, FrozenSet[str]]:
        return {
            table: frozenset(col.key for col in cols if col.key is not None)
            for table, cols in self._server_default_cols.items()
        }

    @HasMemoized.memoized_attribute
    def _server_onupdate_default_col_keys(
        self,
    ) -> Mapping[FromClause, FrozenSet[str]]:
        return {
            table: frozenset(col.key for col in cols if col.key is not None)
            for table, cols in self._server_onupdate_default_cols.items()
        }

    @HasMemoized.memoized_attribute
    def _server_default_plus_onupdate_propkeys(self) -> Set[str]:
        result: Set[str] = set()

        col_to_property = self._columntoproperty
        for table, columns in self._server_default_cols.items():
            result.update(
                col_to_property[col].key
                for col in columns.intersection(col_to_property)
            )
        for table, columns in self._server_onupdate_default_cols.items():
            result.update(
                col_to_property[col].key
                for col in columns.intersection(col_to_property)
            )
        return result

    @HasMemoized.memoized_instancemethod
    def __clause_element__(self):
        annotations: Dict[str, Any] = {
            "entity_namespace": self,
            "parententity": self,
            "parentmapper": self,
        }
        if self.persist_selectable is not self.local_table:
            # joined table inheritance, with polymorphic selectable,
            # etc.
            annotations["dml_table"] = self.local_table._annotate(
                {
                    "entity_namespace": self,
                    "parententity": self,
                    "parentmapper": self,
                }
            )._set_propagate_attrs(
                {"compile_state_plugin": "orm", "plugin_subject": self}
            )

        return self.selectable._annotate(annotations)._set_propagate_attrs(
            {"compile_state_plugin": "orm", "plugin_subject": self}
        )

    @util.memoized_property
    def select_identity_token(self):
        return (
            expression.null()
            ._annotate(
                {
                    "entity_namespace": self,
                    "parententity": self,
                    "parentmapper": self,
                    "identity_token": True,
                }
            )
            ._set_propagate_attrs(
                {"compile_state_plugin": "orm", "plugin_subject": self}
            )
        )

    @property
    def selectable(self) -> FromClause:
        """The :class:`_schema.FromClause` construct this
        :class:`_orm.Mapper` selects from by default.

        Normally, this is equivalent to :attr:`.persist_selectable`, unless
        the ``with_polymorphic`` feature is in use, in which case the
        full "polymorphic" selectable is returned.

        """
        return self._with_polymorphic_selectable

    def _with_polymorphic_args(
        self,
        spec: Any = None,
        selectable: Union[Literal[False, None], FromClause] = False,
        innerjoin: bool = False,
    ) -> Tuple[Sequence[Mapper[Any]], FromClause]:
        if selectable not in (None, False):
            selectable = coercions.expect(
                roles.StrictFromClauseRole, selectable, allow_select=True
            )

        if self.with_polymorphic:
            if not spec:
                spec = self.with_polymorphic[0]
            if selectable is False:
                selectable = self.with_polymorphic[1]
        elif selectable is False:
            selectable = None
        mappers = self._mappers_from_spec(spec, selectable)
        if selectable is not None:
            return mappers, selectable
        else:
            return mappers, self._selectable_from_mappers(mappers, innerjoin)

    @HasMemoized.memoized_attribute
    def _polymorphic_properties(self):
        return list(
            self._iterate_polymorphic_properties(
                self._with_polymorphic_mappers
            )
        )

    @property
    def _all_column_expressions(self):
        poly_properties = self._polymorphic_properties
        adapter = self._polymorphic_adapter

        return [
            adapter.columns[c] if adapter else c
            for prop in poly_properties
            if isinstance(prop, properties.ColumnProperty)
            and prop._renders_in_subqueries
            for c in prop.columns
        ]

    def _columns_plus_keys(self, polymorphic_mappers=()):
        if polymorphic_mappers:
            poly_properties = self._iterate_polymorphic_properties(
                polymorphic_mappers
            )
        else:
            poly_properties = self._polymorphic_properties

        return [
            (prop.key, prop.columns[0])
            for prop in poly_properties
            if isinstance(prop, properties.ColumnProperty)
        ]

    @HasMemoized.memoized_attribute
    def _polymorphic_adapter(self) -> Optional[orm_util.ORMAdapter]:
        if self._has_aliased_polymorphic_fromclause:
            return orm_util.ORMAdapter(
                orm_util._TraceAdaptRole.MAPPER_POLYMORPHIC_ADAPTER,
                self,
                selectable=self.selectable,
                equivalents=self._equivalent_columns,
                limit_on_entity=False,
            )
        else:
            return None

    def _iterate_polymorphic_properties(self, mappers=None):
        """Return an iterator of MapperProperty objects which will render into
        a SELECT."""
        if mappers is None:
            mappers = self._with_polymorphic_mappers

        if not mappers:
            for c in self.iterate_properties:
                yield c
        else:
            # in the polymorphic case, filter out discriminator columns
            # from other mappers, as these are sometimes dependent on that
            # mapper's polymorphic selectable (which we don't want rendered)
            for c in util.unique_list(
                chain(
                    *[
                        list(mapper.iterate_properties)
                        for mapper in [self] + mappers
                    ]
                )
            ):
                if getattr(c, "_is_polymorphic_discriminator", False) and (
                    self.polymorphic_on is None
                    or c.columns[0] is not self.polymorphic_on
                ):
                    continue
                yield c

    @HasMemoized.memoized_attribute
    def attrs(self) -> util.ReadOnlyProperties[MapperProperty[Any]]:
        """A namespace of all :class:`.MapperProperty` objects
        associated this mapper.

        This is an object that provides each property based on
        its key name.  For instance, the mapper for a
        ``User`` class which has ``User.name`` attribute would
        provide ``mapper.attrs.name``, which would be the
        :class:`.ColumnProperty` representing the ``name``
        column.   The namespace object can also be iterated,
        which would yield each :class:`.MapperProperty`.

        :class:`_orm.Mapper` has several pre-filtered views
        of this attribute which limit the types of properties
        returned, including :attr:`.synonyms`, :attr:`.column_attrs`,
        :attr:`.relationships`, and :attr:`.composites`.

        .. warning::

            The :attr:`_orm.Mapper.attrs` accessor namespace is an
            instance of :class:`.OrderedProperties`.  This is
            a dictionary-like object which includes a small number of
            named methods such as :meth:`.OrderedProperties.items`
            and :meth:`.OrderedProperties.values`.  When
            accessing attributes dynamically, favor using the dict-access
            scheme, e.g. ``mapper.attrs[somename]`` over
            ``getattr(mapper.attrs, somename)`` to avoid name collisions.

        .. seealso::

            :attr:`_orm.Mapper.all_orm_descriptors`

        """

        self._check_configure()
        return util.ReadOnlyProperties(self._props)

    @HasMemoized.memoized_attribute
    def all_orm_descriptors(self) -> util.ReadOnlyProperties[InspectionAttr]:
        """A namespace of all :class:`.InspectionAttr` attributes associated
        with the mapped class.

        These attributes are in all cases Python :term:`descriptors`
        associated with the mapped class or its superclasses.

        This namespace includes attributes that are mapped to the class
        as well as attributes declared by extension modules.
        It includes any Python descriptor type that inherits from
        :class:`.InspectionAttr`.  This includes
        :class:`.QueryableAttribute`, as well as extension types such as
        :class:`.hybrid_property`, :class:`.hybrid_method` and
        :class:`.AssociationProxy`.

        To distinguish between mapped attributes and extension attributes,
        the attribute :attr:`.InspectionAttr.extension_type` will refer
        to a constant that distinguishes between different extension types.

        The sorting of the attributes is based on the following rules:

        1. Iterate through the class and its superclasses in order from
           subclass to superclass (i.e. iterate through ``cls.__mro__``)

        2. For each class, yield the attributes in the order in which they
           appear in ``__dict__``, with the exception of those in step
           3 below.  In Python 3.6 and above this ordering will be the
           same as that of the class' construction, with the exception
           of attributes that were added after the fact by the application
           or the mapper.

        3. If a certain attribute key is also in the superclass ``__dict__``,
           then it's included in the iteration for that class, and not the
           class in which it first appeared.

        The above process produces an ordering that is deterministic in terms
        of the order in which attributes were assigned to the class.

        .. versionchanged:: 1.3.19 ensured deterministic ordering for
           :meth:`_orm.Mapper.all_orm_descriptors`.

        When dealing with a :class:`.QueryableAttribute`, the
        :attr:`.QueryableAttribute.property` attribute refers to the
        :class:`.MapperProperty` property, which is what you get when
        referring to the collection of mapped properties via
        :attr:`_orm.Mapper.attrs`.

        .. warning::

            The :attr:`_orm.Mapper.all_orm_descriptors`
            accessor namespace is an
            instance of :class:`.OrderedProperties`.  This is
            a dictionary-like object which includes a small number of
            named methods such as :meth:`.OrderedProperties.items`
            and :meth:`.OrderedProperties.values`.  When
            accessing attributes dynamically, favor using the dict-access
            scheme, e.g. ``mapper.all_orm_descriptors[somename]`` over
            ``getattr(mapper.all_orm_descriptors, somename)`` to avoid name
            collisions.

        .. seealso::

            :attr:`_orm.Mapper.attrs`

        """
        return util.ReadOnlyProperties(
            dict(self.class_manager._all_sqla_attributes())
        )

    @HasMemoized.memoized_attribute
    @util.preload_module("sqlalchemy.orm.descriptor_props")
    def _pk_synonyms(self) -> Dict[str, str]:
        """return a dictionary of {syn_attribute_name: pk_attr_name} for
        all synonyms that refer to primary key columns

        """
        descriptor_props = util.preloaded.orm_descriptor_props

        pk_keys = {prop.key for prop in self._identity_key_props}

        return {
            syn.key: syn.name
            for k, syn in self._props.items()
            if isinstance(syn, descriptor_props.SynonymProperty)
            and syn.name in pk_keys
        }

    @HasMemoized.memoized_attribute
    @util.preload_module("sqlalchemy.orm.descriptor_props")
    def synonyms(self) -> util.ReadOnlyProperties[SynonymProperty[Any]]:
        """Return a namespace of all :class:`.Synonym`
        properties maintained by this :class:`_orm.Mapper`.

        .. seealso::

            :attr:`_orm.Mapper.attrs` - namespace of all
            :class:`.MapperProperty`
            objects.

        """
        descriptor_props = util.preloaded.orm_descriptor_props

        return self._filter_properties(descriptor_props.SynonymProperty)

    @property
    def entity_namespace(self):
        return self.class_

    @HasMemoized.memoized_attribute
    def column_attrs(self) -> util.ReadOnlyProperties[ColumnProperty[Any]]:
        """Return a namespace of all :class:`.ColumnProperty`
        properties maintained by this :class:`_orm.Mapper`.

        .. seealso::

            :attr:`_orm.Mapper.attrs` - namespace of all
            :class:`.MapperProperty`
            objects.

        """
        return self._filter_properties(properties.ColumnProperty)

    @HasMemoized.memoized_attribute
    @util.preload_module("sqlalchemy.orm.relationships")
    def relationships(
        self,
    ) -> util.ReadOnlyProperties[RelationshipProperty[Any]]:
        """A namespace of all :class:`.Relationship` properties
        maintained by this :class:`_orm.Mapper`.

        .. warning::

            the :attr:`_orm.Mapper.relationships` accessor namespace is an
            instance of :class:`.OrderedProperties`.  This is
            a dictionary-like object which includes a small number of
            named methods such as :meth:`.OrderedProperties.items`
            and :meth:`.OrderedProperties.values`.  When
            accessing attributes dynamically, favor using the dict-access
            scheme, e.g. ``mapper.relationships[somename]`` over
            ``getattr(mapper.relationships, somename)`` to avoid name
            collisions.

        .. seealso::

            :attr:`_orm.Mapper.attrs` - namespace of all
            :class:`.MapperProperty`
            objects.

        """
        return self._filter_properties(
            util.preloaded.orm_relationships.RelationshipProperty
        )

    @HasMemoized.memoized_attribute
    @util.preload_module("sqlalchemy.orm.descriptor_props")
    def composites(self) -> util.ReadOnlyProperties[CompositeProperty[Any]]:
        """Return a namespace of all :class:`.Composite`
        properties maintained by this :class:`_orm.Mapper`.

        .. seealso::

            :attr:`_orm.Mapper.attrs` - namespace of all
            :class:`.MapperProperty`
            objects.

        """
        return self._filter_properties(
            util.preloaded.orm_descriptor_props.CompositeProperty
        )

    def _filter_properties(
        self, type_: Type[_MP]
    ) -> util.ReadOnlyProperties[_MP]:
        self._check_configure()
        return util.ReadOnlyProperties(
            util.OrderedDict(
                (k, v) for k, v in self._props.items() if isinstance(v, type_)
            )
        )

    @HasMemoized.memoized_attribute
    def _get_clause(self):
        """create a "get clause" based on the primary key.  this is used
        by query.get() and many-to-one lazyloads to load this item
        by primary key.

        """
        params = [
            (
                primary_key,
                sql.bindparam("pk_%d" % idx, type_=primary_key.type),
            )
            for idx, primary_key in enumerate(self.primary_key, 1)
        ]
        return (
            sql.and_(*[k == v for (k, v) in params]),
            util.column_dict(params),
        )

    @HasMemoized.memoized_attribute
    def _equivalent_columns(self) -> _EquivalentColumnMap:
        """Create a map of all equivalent columns, based on
        the determination of column pairs that are equated to
        one another based on inherit condition.  This is designed
        to work with the queries that util.polymorphic_union
        comes up with, which often don't include the columns from
        the base table directly (including the subclass table columns
        only).

        The resulting structure is a dictionary of columns mapped
        to lists of equivalent columns, e.g.::

            {
                tablea.col1:
                    {tableb.col1, tablec.col1},
                tablea.col2:
                    {tabled.col2}
            }

        """
        result: _EquivalentColumnMap = {}

        def visit_binary(binary):
            if binary.operator == operators.eq:
                if binary.left in result:
                    result[binary.left].add(binary.right)
                else:
                    result[binary.left] = {binary.right}
                if binary.right in result:
                    result[binary.right].add(binary.left)
                else:
                    result[binary.right] = {binary.left}

        for mapper in self.base_mapper.self_and_descendants:
            if mapper.inherit_condition is not None:
                visitors.traverse(
                    mapper.inherit_condition, {}, {"binary": visit_binary}
                )

        return result

    def _is_userland_descriptor(self, assigned_name: str, obj: Any) -> bool:
        if isinstance(
            obj,
            (
                _MappedAttribute,
                instrumentation.ClassManager,
                expression.ColumnElement,
            ),
        ):
            return False
        else:
            return assigned_name not in self._dataclass_fields

    @HasMemoized.memoized_attribute
    def _dataclass_fields(self):
        return [f.name for f in util.dataclass_fields(self.class_)]

    def _should_exclude(self, name, assigned_name, local, column):
        """determine whether a particular property should be implicitly
        present on the class.

        This occurs when properties are propagated from an inherited class, or
        are applied from the columns present in the mapped table.

        """

        if column is not None and sql_base._never_select_column(column):
            return True

        # check for class-bound attributes and/or descriptors,
        # either local or from an inherited class
        # ignore dataclass field default values
        if local:
            if self.class_.__dict__.get(
                assigned_name, None
            ) is not None and self._is_userland_descriptor(
                assigned_name, self.class_.__dict__[assigned_name]
            ):
                return True
        else:
            attr = self.class_manager._get_class_attr_mro(assigned_name, None)
            if attr is not None and self._is_userland_descriptor(
                assigned_name, attr
            ):
                return True

        if (
            self.include_properties is not None
            and name not in self.include_properties
            and (column is None or column not in self.include_properties)
        ):
            self._log("not including property %s" % (name))
            return True

        if self.exclude_properties is not None and (
            name in self.exclude_properties
            or (column is not None and column in self.exclude_properties)
        ):
            self._log("excluding property %s" % (name))
            return True

        return False

    def common_parent(self, other: Mapper[Any]) -> bool:
        """Return true if the given mapper shares a
        common inherited parent as this mapper."""

        return self.base_mapper is other.base_mapper

    def is_sibling(self, other: Mapper[Any]) -> bool:
        """return true if the other mapper is an inheriting sibling to this
        one.  common parent but different branch

        """
        return (
            self.base_mapper is other.base_mapper
            and not self.isa(other)
            and not other.isa(self)
        )

    def _canload(
        self, state: InstanceState[Any], allow_subtypes: bool
    ) -> bool:
        s = self.primary_mapper()
        if self.polymorphic_on is not None or allow_subtypes:
            return _state_mapper(state).isa(s)
        else:
            return _state_mapper(state) is s

    def isa(self, other: Mapper[Any]) -> bool:
        """Return True if the this mapper inherits from the given mapper."""

        m: Optional[Mapper[Any]] = self
        while m and m is not other:
            m = m.inherits
        return bool(m)

    def iterate_to_root(self) -> Iterator[Mapper[Any]]:
        m: Optional[Mapper[Any]] = self
        while m:
            yield m
            m = m.inherits

    @HasMemoized.memoized_attribute
    def self_and_descendants(self) -> Sequence[Mapper[Any]]:
        """The collection including this mapper and all descendant mappers.

        This includes not just the immediately inheriting mappers but
        all their inheriting mappers as well.

        """
        descendants = []
        stack = deque([self])
        while stack:
            item = stack.popleft()
            descendants.append(item)
            stack.extend(item._inheriting_mappers)
        return util.WeakSequence(descendants)

    def polymorphic_iterator(self) -> Iterator[Mapper[Any]]:
        """Iterate through the collection including this mapper and
        all descendant mappers.

        This includes not just the immediately inheriting mappers but
        all their inheriting mappers as well.

        To iterate through an entire hierarchy, use
        ``mapper.base_mapper.polymorphic_iterator()``.

        """
        return iter(self.self_and_descendants)

    def primary_mapper(self) -> Mapper[Any]:
        """Return the primary mapper corresponding to this mapper's class key
        (class)."""

        return self.class_manager.mapper

    @property
    def primary_base_mapper(self) -> Mapper[Any]:
        return self.class_manager.mapper.base_mapper

    def _result_has_identity_key(self, result, adapter=None):
        pk_cols: Sequence[ColumnClause[Any]] = self.primary_key
        if adapter:
            pk_cols = [adapter.columns[c] for c in pk_cols]
        rk = result.keys()
        for col in pk_cols:
            if col not in rk:
                return False
        else:
            return True

    def identity_key_from_row(
        self,
        row: Optional[Union[Row[Any], RowMapping]],
        identity_token: Optional[Any] = None,
        adapter: Optional[ORMAdapter] = None,
    ) -> _IdentityKeyType[_O]:
        """Return an identity-map key for use in storing/retrieving an
        item from the identity map.

        :param row: A :class:`.Row` or :class:`.RowMapping` produced from a
         result set that selected from the ORM mapped primary key columns.

         .. versionchanged:: 2.0
            :class:`.Row` or :class:`.RowMapping` are accepted
            for the "row" argument

        """
        pk_cols: Sequence[ColumnClause[Any]] = self.primary_key
        if adapter:
            pk_cols = [adapter.columns[c] for c in pk_cols]

        if hasattr(row, "_mapping"):
            mapping = row._mapping  # type: ignore
        else:
            mapping = cast("Mapping[Any, Any]", row)

        return (
            self._identity_class,
            tuple(mapping[column] for column in pk_cols),  # type: ignore
            identity_token,
        )

    def identity_key_from_primary_key(
        self,
        primary_key: Tuple[Any, ...],
        identity_token: Optional[Any] = None,
    ) -> _IdentityKeyType[_O]:
        """Return an identity-map key for use in storing/retrieving an
        item from an identity map.

        :param primary_key: A list of values indicating the identifier.

        """
        return (
            self._identity_class,
            tuple(primary_key),
            identity_token,
        )

    def identity_key_from_instance(self, instance: _O) -> _IdentityKeyType[_O]:
        """Return the identity key for the given instance, based on
        its primary key attributes.

        If the instance's state is expired, calling this method
        will result in a database check to see if the object has been deleted.
        If the row no longer exists,
        :class:`~sqlalchemy.orm.exc.ObjectDeletedError` is raised.

        This value is typically also found on the instance state under the
        attribute name `key`.

        """
        state = attributes.instance_state(instance)
        return self._identity_key_from_state(state, PassiveFlag.PASSIVE_OFF)

    def _identity_key_from_state(
        self,
        state: InstanceState[_O],
        passive: PassiveFlag = PassiveFlag.PASSIVE_RETURN_NO_VALUE,
    ) -> _IdentityKeyType[_O]:
        dict_ = state.dict
        manager = state.manager
        return (
            self._identity_class,
            tuple(
                [
                    manager[prop.key].impl.get(state, dict_, passive)
                    for prop in self._identity_key_props
                ]
            ),
            state.identity_token,
        )

    def primary_key_from_instance(self, instance: _O) -> Tuple[Any, ...]:
        """Return the list of primary key values for the given
        instance.

        If the instance's state is expired, calling this method
        will result in a database check to see if the object has been deleted.
        If the row no longer exists,
        :class:`~sqlalchemy.orm.exc.ObjectDeletedError` is raised.

        """
        state = attributes.instance_state(instance)
        identity_key = self._identity_key_from_state(
            state, PassiveFlag.PASSIVE_OFF
        )
        return identity_key[1]

    @HasMemoized.memoized_attribute
    def _persistent_sortkey_fn(self):
        key_fns = [col.type.sort_key_function for col in self.primary_key]

        if set(key_fns).difference([None]):

            def key(state):
                return tuple(
                    key_fn(val) if key_fn is not None else val
                    for key_fn, val in zip(key_fns, state.key[1])
                )

        else:

            def key(state):
                return state.key[1]

        return key

    @HasMemoized.memoized_attribute
    def _identity_key_props(self):
        return [self._columntoproperty[col] for col in self.primary_key]

    @HasMemoized.memoized_attribute
    def _all_pk_cols(self):
        collection: Set[ColumnClause[Any]] = set()
        for table in self.tables:
            collection.update(self._pks_by_table[table])
        return collection

    @HasMemoized.memoized_attribute
    def _should_undefer_in_wildcard(self):
        cols: Set[ColumnElement[Any]] = set(self.primary_key)
        if self.polymorphic_on is not None:
            cols.add(self.polymorphic_on)
        return cols

    @HasMemoized.memoized_attribute
    def _primary_key_propkeys(self):
        return {self._columntoproperty[col].key for col in self._all_pk_cols}

    def _get_state_attr_by_column(
        self,
        state: InstanceState[_O],
        dict_: _InstanceDict,
        column: ColumnElement[Any],
        passive: PassiveFlag = PassiveFlag.PASSIVE_RETURN_NO_VALUE,
    ) -> Any:
        prop = self._columntoproperty[column]
        return state.manager[prop.key].impl.get(state, dict_, passive=passive)

    def _set_committed_state_attr_by_column(self, state, dict_, column, value):
        prop = self._columntoproperty[column]
        state.manager[prop.key].impl.set_committed_value(state, dict_, value)

    def _set_state_attr_by_column(self, state, dict_, column, value):
        prop = self._columntoproperty[column]
        state.manager[prop.key].impl.set(state, dict_, value, None)

    def _get_committed_attr_by_column(self, obj, column):
        state = attributes.instance_state(obj)
        dict_ = attributes.instance_dict(obj)
        return self._get_committed_state_attr_by_column(
            state, dict_, column, passive=PassiveFlag.PASSIVE_OFF
        )

    def _get_committed_state_attr_by_column(
        self, state, dict_, column, passive=PassiveFlag.PASSIVE_RETURN_NO_VALUE
    ):
        prop = self._columntoproperty[column]
        return state.manager[prop.key].impl.get_committed_value(
            state, dict_, passive=passive
        )

    def _optimized_get_statement(self, state, attribute_names):
        """assemble a WHERE clause which retrieves a given state by primary
        key, using a minimized set of tables.

        Applies to a joined-table inheritance mapper where the
        requested attribute names are only present on joined tables,
        not the base table.  The WHERE clause attempts to include
        only those tables to minimize joins.

        """
        props = self._props

        col_attribute_names = set(attribute_names).intersection(
            state.mapper.column_attrs.keys()
        )
        tables: Set[FromClause] = set(
            chain(
                *[
                    sql_util.find_tables(c, check_columns=True)
                    for key in col_attribute_names
                    for c in props[key].columns
                ]
            )
        )

        if self.base_mapper.local_table in tables:
            return None

        def visit_binary(binary):
            leftcol = binary.left
            rightcol = binary.right
            if leftcol is None or rightcol is None:
                return

            if leftcol.table not in tables:
                leftval = self._get_committed_state_attr_by_column(
                    state,
                    state.dict,
                    leftcol,
                    passive=PassiveFlag.PASSIVE_NO_INITIALIZE,
                )
                if leftval in orm_util._none_set:
                    raise _OptGetColumnsNotAvailable()
                binary.left = sql.bindparam(
                    None, leftval, type_=binary.right.type
                )
            elif rightcol.table not in tables:
                rightval = self._get_committed_state_attr_by_column(
                    state,
                    state.dict,
                    rightcol,
                    passive=PassiveFlag.PASSIVE_NO_INITIALIZE,
                )
                if rightval in orm_util._none_set:
                    raise _OptGetColumnsNotAvailable()
                binary.right = sql.bindparam(
                    None, rightval, type_=binary.right.type
                )

        allconds: List[ColumnElement[bool]] = []

        start = False

        # as of #7507, from the lowest base table on upwards,
        # we include all intermediary tables.

        for mapper in reversed(list(self.iterate_to_root())):
            if mapper.local_table in tables:
                start = True
            elif not isinstance(mapper.local_table, expression.TableClause):
                return None
            if start and not mapper.single:
                assert mapper.inherits
                assert not mapper.concrete
                assert mapper.inherit_condition is not None
                allconds.append(mapper.inherit_condition)
                tables.add(mapper.local_table)

        # only the bottom table needs its criteria to be altered to fit
        # the primary key ident - the rest of the tables upwards to the
        # descendant-most class should all be present and joined to each
        # other.
        try:
            _traversed = visitors.cloned_traverse(
                allconds[0], {}, {"binary": visit_binary}
            )
        except _OptGetColumnsNotAvailable:
            return None
        else:
            allconds[0] = _traversed

        cond = sql.and_(*allconds)

        cols = []
        for key in col_attribute_names:
            cols.extend(props[key].columns)
        return (
            sql.select(*cols)
            .where(cond)
            .set_label_style(LABEL_STYLE_TABLENAME_PLUS_COL)
        )

    def _iterate_to_target_viawpoly(self, mapper):
        if self.isa(mapper):
            prev = self
            for m in self.iterate_to_root():
                yield m

                if m is not prev and prev not in m._with_polymorphic_mappers:
                    break

                prev = m
                if m is mapper:
                    break

    @HasMemoized.memoized_attribute
    def _would_selectinload_combinations_cache(self):
        return {}

    def _would_selectin_load_only_from_given_mapper(self, super_mapper):
        """return True if this mapper would "selectin" polymorphic load based
        on the given super mapper, and not from a setting from a subclass.

        given::

            class A:
                ...

            class B(A):
                __mapper_args__ = {"polymorphic_load": "selectin"}

            class C(B):
                ...

            class D(B):
                __mapper_args__ = {"polymorphic_load": "selectin"}

        ``inspect(C)._would_selectin_load_only_from_given_mapper(inspect(B))``
        returns True, because C does selectin loading because of B's setting.

        OTOH, ``inspect(D)
        ._would_selectin_load_only_from_given_mapper(inspect(B))``
        returns False, because D does selectin loading because of its own
        setting; when we are doing a selectin poly load from B, we want to
        filter out D because it would already have its own selectin poly load
        set up separately.

        Added as part of #9373.

        """
        cache = self._would_selectinload_combinations_cache

        try:
            return cache[super_mapper]
        except KeyError:
            pass

        # assert that given object is a supermapper, meaning we already
        # strong reference it directly or indirectly.  this allows us
        # to not worry that we are creating new strongrefs to unrelated
        # mappers or other objects.
        assert self.isa(super_mapper)

        mapper = super_mapper
        for m in self._iterate_to_target_viawpoly(mapper):
            if m.polymorphic_load == "selectin":
                retval = m is super_mapper
                break
        else:
            retval = False

        cache[super_mapper] = retval
        return retval

    def _should_selectin_load(self, enabled_via_opt, polymorphic_from):
        if not enabled_via_opt:
            # common case, takes place for all polymorphic loads
            mapper = polymorphic_from
            for m in self._iterate_to_target_viawpoly(mapper):
                if m.polymorphic_load == "selectin":
                    return m
        else:
            # uncommon case, selectin load options were used
            enabled_via_opt = set(enabled_via_opt)
            enabled_via_opt_mappers = {e.mapper: e for e in enabled_via_opt}
            for entity in enabled_via_opt.union([polymorphic_from]):
                mapper = entity.mapper
                for m in self._iterate_to_target_viawpoly(mapper):
                    if (
                        m.polymorphic_load == "selectin"
                        or m in enabled_via_opt_mappers
                    ):
                        return enabled_via_opt_mappers.get(m, m)

        return None

    @util.preload_module("sqlalchemy.orm.strategy_options")
    def _subclass_load_via_in(self, entity, polymorphic_from):
        """Assemble a that can load the columns local to
        this subclass as a SELECT with IN.

        """
        strategy_options = util.preloaded.orm_strategy_options

        assert self.inherits

        if self.polymorphic_on is not None:
            polymorphic_prop = self._columntoproperty[self.polymorphic_on]
            keep_props = set([polymorphic_prop] + self._identity_key_props)
        else:
            keep_props = set(self._identity_key_props)

        disable_opt = strategy_options.Load(entity)
        enable_opt = strategy_options.Load(entity)

        classes_to_include = {self}
        m: Optional[Mapper[Any]] = self.inherits
        while (
            m is not None
            and m is not polymorphic_from
            and m.polymorphic_load == "selectin"
        ):
            classes_to_include.add(m)
            m = m.inherits

        for prop in self.attrs:
            # skip prop keys that are not instrumented on the mapped class.
            # this is primarily the "_sa_polymorphic_on" property that gets
            # created for an ad-hoc polymorphic_on SQL expression, issue #8704
            if prop.key not in self.class_manager:
                continue

            if prop.parent in classes_to_include or prop in keep_props:
                # "enable" options, to turn on the properties that we want to
                # load by default (subject to options from the query)
                if not isinstance(prop, StrategizedProperty):
                    continue

                enable_opt = enable_opt._set_generic_strategy(
                    # convert string name to an attribute before passing
                    # to loader strategy.   note this must be in terms
                    # of given entity, such as AliasedClass, etc.
                    (getattr(entity.entity_namespace, prop.key),),
                    dict(prop.strategy_key),
                    _reconcile_to_other=True,
                )
            else:
                # "disable" options, to turn off the properties from the
                # superclass that we *don't* want to load, applied after
                # the options from the query to override them
                disable_opt = disable_opt._set_generic_strategy(
                    # convert string name to an attribute before passing
                    # to loader strategy.   note this must be in terms
                    # of given entity, such as AliasedClass, etc.
                    (getattr(entity.entity_namespace, prop.key),),
                    {"do_nothing": True},
                    _reconcile_to_other=False,
                )

        primary_key = [
            sql_util._deep_annotate(pk, {"_orm_adapt": True})
            for pk in self.primary_key
        ]

        in_expr: ColumnElement[Any]

        if len(primary_key) > 1:
            in_expr = sql.tuple_(*primary_key)
        else:
            in_expr = primary_key[0]

        if entity.is_aliased_class:
            assert entity.mapper is self

            q = sql.select(entity).set_label_style(
                LABEL_STYLE_TABLENAME_PLUS_COL
            )

            in_expr = entity._adapter.traverse(in_expr)
            primary_key = [entity._adapter.traverse(k) for k in primary_key]
            q = q.where(
                in_expr.in_(sql.bindparam("primary_keys", expanding=True))
            ).order_by(*primary_key)
        else:
            q = sql.select(self).set_label_style(
                LABEL_STYLE_TABLENAME_PLUS_COL
            )
            q = q.where(
                in_expr.in_(sql.bindparam("primary_keys", expanding=True))
            ).order_by(*primary_key)

        return q, enable_opt, disable_opt

    @HasMemoized.memoized_attribute
    def _subclass_load_via_in_mapper(self):
        # the default is loading this mapper against the basemost mapper
        return self._subclass_load_via_in(self, self.base_mapper)

    def cascade_iterator(
        self,
        type_: str,
        state: InstanceState[_O],
        halt_on: Optional[Callable[[InstanceState[Any]], bool]] = None,
    ) -> Iterator[
        Tuple[object, Mapper[Any], InstanceState[Any], _InstanceDict]
    ]:
        r"""Iterate each element and its mapper in an object graph,
        for all relationships that meet the given cascade rule.

        :param type\_:
          The name of the cascade rule (i.e. ``"save-update"``, ``"delete"``,
          etc.).

          .. note::  the ``"all"`` cascade is not accepted here.  For a generic
             object traversal function, see :ref:`faq_walk_objects`.

        :param state:
          The lead InstanceState.  child items will be processed per
          the relationships defined for this object's mapper.

        :return: the method yields individual object instances.

        .. seealso::

            :ref:`unitofwork_cascades`

            :ref:`faq_walk_objects` - illustrates a generic function to
            traverse all objects without relying on cascades.

        """
        visited_states: Set[InstanceState[Any]] = set()
        prp, mpp = object(), object()

        assert state.mapper.isa(self)

        # this is actually a recursive structure, fully typing it seems
        # a little too difficult for what it's worth here
        visitables: Deque[
            Tuple[
                Deque[Any],
                object,
                Optional[InstanceState[Any]],
                Optional[_InstanceDict],
            ]
        ]

        visitables = deque(
            [(deque(state.mapper._props.values()), prp, state, state.dict)]
        )

        while visitables:
            iterator, item_type, parent_state, parent_dict = visitables[-1]
            if not iterator:
                visitables.pop()
                continue

            if item_type is prp:
                prop = iterator.popleft()
                if not prop.cascade or type_ not in prop.cascade:
                    continue
                assert parent_state is not None
                assert parent_dict is not None
                queue = deque(
                    prop.cascade_iterator(
                        type_,
                        parent_state,
                        parent_dict,
                        visited_states,
                        halt_on,
                    )
                )
                if queue:
                    visitables.append((queue, mpp, None, None))
            elif item_type is mpp:
                (
                    instance,
                    instance_mapper,
                    corresponding_state,
                    corresponding_dict,
                ) = iterator.popleft()
                yield (
                    instance,
                    instance_mapper,
                    corresponding_state,
                    corresponding_dict,
                )
                visitables.append(
                    (
                        deque(instance_mapper._props.values()),
                        prp,
                        corresponding_state,
                        corresponding_dict,
                    )
                )

    @HasMemoized.memoized_attribute
    def _compiled_cache(self):
        return util.LRUCache(self._compiled_cache_size)

    @HasMemoized.memoized_attribute
    def _multiple_persistence_tables(self):
        return len(self.tables) > 1

    @HasMemoized.memoized_attribute
    def _sorted_tables(self):
        table_to_mapper: Dict[TableClause, Mapper[Any]] = {}

        for mapper in self.base_mapper.self_and_descendants:
            for t in mapper.tables:
                table_to_mapper.setdefault(t, mapper)

        extra_dependencies = []
        for table, mapper in table_to_mapper.items():
            super_ = mapper.inherits
            if super_:
                extra_dependencies.extend(
                    [(super_table, table) for super_table in super_.tables]
                )

        def skip(fk):
            # attempt to skip dependencies that are not
            # significant to the inheritance chain
            # for two tables that are related by inheritance.
            # while that dependency may be important, it's technically
            # not what we mean to sort on here.
            parent = table_to_mapper.get(fk.parent.table)
            dep = table_to_mapper.get(fk.column.table)
            if (
                parent is not None
                and dep is not None
                and dep is not parent
                and dep.inherit_condition is not None
            ):
                cols = set(sql_util._find_columns(dep.inherit_condition))
                if parent.inherit_condition is not None:
                    cols = cols.union(
                        sql_util._find_columns(parent.inherit_condition)
                    )
                    return fk.parent not in cols and fk.column not in cols
                else:
                    return fk.parent not in cols
            return False

        sorted_ = sql_util.sort_tables(
            table_to_mapper,
            skip_fn=skip,
            extra_dependencies=extra_dependencies,
        )

        ret = util.OrderedDict()
        for t in sorted_:
            ret[t] = table_to_mapper[t]
        return ret

    def _memo(self, key: Any, callable_: Callable[[], _T]) -> _T:
        if key in self._memoized_values:
            return cast(_T, self._memoized_values[key])
        else:
            self._memoized_values[key] = value = callable_()
            return value

    @util.memoized_property
    def _table_to_equated(self):
        """memoized map of tables to collections of columns to be
        synchronized upwards to the base mapper."""

        result: util.defaultdict[
            Table,
            List[
                Tuple[
                    Mapper[Any],
                    List[Tuple[ColumnElement[Any], ColumnElement[Any]]],
                ]
            ],
        ] = util.defaultdict(list)

        def set_union(x, y):
            return x.union(y)

        for table in self._sorted_tables:
            cols = set(table.c)

            for m in self.iterate_to_root():
                if m._inherits_equated_pairs and cols.intersection(
                    reduce(
                        set_union,
                        [l.proxy_set for l, r in m._inherits_equated_pairs],
                    )
                ):
                    result[table].append((m, m._inherits_equated_pairs))

        return result


class _OptGetColumnsNotAvailable(Exception):
    pass


def configure_mappers() -> None:
    """Initialize the inter-mapper relationships of all mappers that
    have been constructed thus far across all :class:`_orm.registry`
    collections.

    The configure step is used to reconcile and initialize the
    :func:`_orm.relationship` linkages between mapped classes, as well as to
    invoke configuration events such as the
    :meth:`_orm.MapperEvents.before_configured` and
    :meth:`_orm.MapperEvents.after_configured`, which may be used by ORM
    extensions or user-defined extension hooks.

    Mapper configuration is normally invoked automatically, the first time
    mappings from a particular :class:`_orm.registry` are used, as well as
    whenever mappings are used and additional not-yet-configured mappers have
    been constructed. The automatic configuration process however is local only
    to the :class:`_orm.registry` involving the target mapper and any related
    :class:`_orm.registry` objects which it may depend on; this is
    equivalent to invoking the :meth:`_orm.registry.configure` method
    on a particular :class:`_orm.registry`.

    By contrast, the :func:`_orm.configure_mappers` function will invoke the
    configuration process on all :class:`_orm.registry` objects that
    exist in memory, and may be useful for scenarios where many individual
    :class:`_orm.registry` objects that are nonetheless interrelated are
    in use.

    .. versionchanged:: 1.4

        As of SQLAlchemy 1.4.0b2, this function works on a
        per-:class:`_orm.registry` basis, locating all :class:`_orm.registry`
        objects present and invoking the :meth:`_orm.registry.configure` method
        on each. The :meth:`_orm.registry.configure` method may be preferred to
        limit the configuration of mappers to those local to a particular
        :class:`_orm.registry` and/or declarative base class.

    Points at which automatic configuration is invoked include when a mapped
    class is instantiated into an instance, as well as when ORM queries
    are emitted using :meth:`.Session.query` or :meth:`_orm.Session.execute`
    with an ORM-enabled statement.

    The mapper configure process, whether invoked by
    :func:`_orm.configure_mappers` or from :meth:`_orm.registry.configure`,
    provides several event hooks that can be used to augment the mapper
    configuration step. These hooks include:

    * :meth:`.MapperEvents.before_configured` - called once before
      :func:`.configure_mappers` or :meth:`_orm.registry.configure` does any
      work; this can be used to establish additional options, properties, or
      related mappings before the operation proceeds.

    * :meth:`.MapperEvents.mapper_configured` - called as each individual
      :class:`_orm.Mapper` is configured within the process; will include all
      mapper state except for backrefs set up by other mappers that are still
      to be configured.

    * :meth:`.MapperEvents.after_configured` - called once after
      :func:`.configure_mappers` or :meth:`_orm.registry.configure` is
      complete; at this stage, all :class:`_orm.Mapper` objects that fall
      within the scope of the configuration operation will be fully configured.
      Note that the calling application may still have other mappings that
      haven't been produced yet, such as if they are in modules as yet
      unimported, and may also have mappings that are still to be configured,
      if they are in other :class:`_orm.registry` collections not part of the
      current scope of configuration.

    """

    _configure_registries(_all_registries(), cascade=True)


def _configure_registries(
    registries: Set[_RegistryType], cascade: bool
) -> None:
    for reg in registries:
        if reg._new_mappers:
            break
    else:
        return

    with _CONFIGURE_MUTEX:
        global _already_compiling
        if _already_compiling:
            return
        _already_compiling = True
        try:
            # double-check inside mutex
            for reg in registries:
                if reg._new_mappers:
                    break
            else:
                return

            Mapper.dispatch._for_class(Mapper).before_configured()  # type: ignore # noqa: E501
            # initialize properties on all mappers
            # note that _mapper_registry is unordered, which
            # may randomly conceal/reveal issues related to
            # the order of mapper compilation

            _do_configure_registries(registries, cascade)
        finally:
            _already_compiling = False
    Mapper.dispatch._for_class(Mapper).after_configured()  # type: ignore


@util.preload_module("sqlalchemy.orm.decl_api")
def _do_configure_registries(
    registries: Set[_RegistryType], cascade: bool
) -> None:
    registry = util.preloaded.orm_decl_api.registry

    orig = set(registries)

    for reg in registry._recurse_with_dependencies(registries):
        has_skip = False

        for mapper in reg._mappers_to_configure():
            run_configure = None

            for fn in mapper.dispatch.before_mapper_configured:
                run_configure = fn(mapper, mapper.class_)
                if run_configure is EXT_SKIP:
                    has_skip = True
                    break
            if run_configure is EXT_SKIP:
                continue

            if getattr(mapper, "_configure_failed", False):
                e = sa_exc.InvalidRequestError(
                    "One or more mappers failed to initialize - "
                    "can't proceed with initialization of other "
                    "mappers. Triggering mapper: '%s'. "
                    "Original exception was: %s"
                    % (mapper, mapper._configure_failed)
                )
                e._configure_failed = mapper._configure_failed  # type: ignore
                raise e

            if not mapper.configured:
                try:
                    mapper._post_configure_properties()
                    mapper._expire_memoizations()
                    mapper.dispatch.mapper_configured(mapper, mapper.class_)
                except Exception:
                    exc = sys.exc_info()[1]
                    if not hasattr(exc, "_configure_failed"):
                        mapper._configure_failed = exc
                    raise
        if not has_skip:
            reg._new_mappers = False

        if not cascade and reg._dependencies.difference(orig):
            raise sa_exc.InvalidRequestError(
                "configure was called with cascade=False but "
                "additional registries remain"
            )


@util.preload_module("sqlalchemy.orm.decl_api")
def _dispose_registries(registries: Set[_RegistryType], cascade: bool) -> None:
    registry = util.preloaded.orm_decl_api.registry

    orig = set(registries)

    for reg in registry._recurse_with_dependents(registries):
        if not cascade and reg._dependents.difference(orig):
            raise sa_exc.InvalidRequestError(
                "Registry has dependent registries that are not disposed; "
                "pass cascade=True to clear these also"
            )

        while reg._managers:
            try:
                manager, _ = reg._managers.popitem()
            except KeyError:
                # guard against race between while and popitem
                pass
            else:
                reg._dispose_manager_and_mapper(manager)

        reg._non_primary_mappers.clear()
        reg._dependents.clear()
        for dep in reg._dependencies:
            dep._dependents.discard(reg)
        reg._dependencies.clear()
        # this wasn't done in the 1.3 clear_mappers() and in fact it
        # was a bug, as it could cause configure_mappers() to invoke
        # the "before_configured" event even though mappers had all been
        # disposed.
        reg._new_mappers = False


def reconstructor(fn):
    """Decorate a method as the 'reconstructor' hook.

    Designates a single method as the "reconstructor", an ``__init__``-like
    method that will be called by the ORM after the instance has been
    loaded from the database or otherwise reconstituted.

    .. tip::

        The :func:`_orm.reconstructor` decorator makes use of the
        :meth:`_orm.InstanceEvents.load` event hook, which can be
        used directly.

    The reconstructor will be invoked with no arguments.  Scalar
    (non-collection) database-mapped attributes of the instance will
    be available for use within the function.  Eagerly-loaded
    collections are generally not yet available and will usually only
    contain the first element.  ORM state changes made to objects at
    this stage will not be recorded for the next flush() operation, so
    the activity within a reconstructor should be conservative.

    .. seealso::

        :meth:`.InstanceEvents.load`

    """
    fn.__sa_reconstructor__ = True
    return fn


def validates(
    *names: str, include_removes: bool = False, include_backrefs: bool = True
) -> Callable[[_Fn], _Fn]:
    r"""Decorate a method as a 'validator' for one or more named properties.

    Designates a method as a validator, a method which receives the
    name of the attribute as well as a value to be assigned, or in the
    case of a collection, the value to be added to the collection.
    The function can then raise validation exceptions to halt the
    process from continuing (where Python's built-in ``ValueError``
    and ``AssertionError`` exceptions are reasonable choices), or can
    modify or replace the value before proceeding. The function should
    otherwise return the given value.

    Note that a validator for a collection **cannot** issue a load of that
    collection within the validation routine - this usage raises
    an assertion to avoid recursion overflows.  This is a reentrant
    condition which is not supported.

    :param \*names: list of attribute names to be validated.
    :param include_removes: if True, "remove" events will be
     sent as well - the validation function must accept an additional
     argument "is_remove" which will be a boolean.

    :param include_backrefs: defaults to ``True``; if ``False``, the
     validation function will not emit if the originator is an attribute
     event related via a backref.  This can be used for bi-directional
     :func:`.validates` usage where only one validator should emit per
     attribute operation.

     .. versionchanged:: 2.0.16 This paramter inadvertently defaulted to
        ``False`` for releases 2.0.0 through 2.0.15.  Its correct default
        of ``True`` is restored in 2.0.16.

    .. seealso::

      :ref:`simple_validators` - usage examples for :func:`.validates`

    """

    def wrap(fn: _Fn) -> _Fn:
        fn.__sa_validators__ = names  # type: ignore[attr-defined]
        fn.__sa_validation_opts__ = {  # type: ignore[attr-defined]
            "include_removes": include_removes,
            "include_backrefs": include_backrefs,
        }
        return fn

    return wrap


def _event_on_load(state, ctx):
    instrumenting_mapper = state.manager.mapper

    if instrumenting_mapper._reconstructor:
        instrumenting_mapper._reconstructor(state.obj())


def _event_on_init(state, args, kwargs):
    """Run init_instance hooks.

    This also includes mapper compilation, normally not needed
    here but helps with some piecemeal configuration
    scenarios (such as in the ORM tutorial).

    """

    instrumenting_mapper = state.manager.mapper
    if instrumenting_mapper:
        instrumenting_mapper._check_configure()
        if instrumenting_mapper._set_polymorphic_identity:
            instrumenting_mapper._set_polymorphic_identity(state)


class _ColumnMapping(Dict["ColumnElement[Any]", "MapperProperty[Any]"]):
    """Error reporting helper for mapper._columntoproperty."""

    __slots__ = ("mapper",)

    def __init__(self, mapper):
        # TODO: weakref would be a good idea here
        self.mapper = mapper

    def __missing__(self, column):
        prop = self.mapper._props.get(column)
        if prop:
            raise orm_exc.UnmappedColumnError(
                "Column '%s.%s' is not available, due to "
                "conflicting property '%s':%r"
                % (column.table.name, column.name, column.key, prop)
            )
        raise orm_exc.UnmappedColumnError(
            "No column %s is configured on mapper %s..."
            % (column, self.mapper)
        )
