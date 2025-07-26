# orm/properties.py
# Copyright (C) 2005-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php

"""MapperProperty implementations.

This is a private module which defines the behavior of individual ORM-
mapped attributes.

"""

from __future__ import annotations

from typing import Any
from typing import cast
from typing import Dict
from typing import List
from typing import Optional
from typing import Sequence
from typing import Set
from typing import Tuple
from typing import Type
from typing import TYPE_CHECKING
from typing import TypeVar
from typing import Union

from . import attributes
from . import strategy_options
from .base import _DeclarativeMapped
from .base import class_mapper
from .descriptor_props import CompositeProperty
from .descriptor_props import ConcreteInheritedProperty
from .descriptor_props import SynonymProperty
from .interfaces import _AttributeOptions
from .interfaces import _DEFAULT_ATTRIBUTE_OPTIONS
from .interfaces import _IntrospectsAnnotations
from .interfaces import _MapsColumns
from .interfaces import MapperProperty
from .interfaces import PropComparator
from .interfaces import StrategizedProperty
from .relationships import RelationshipProperty
from .util import de_stringify_annotation
from .util import de_stringify_union_elements
from .. import exc as sa_exc
from .. import ForeignKey
from .. import log
from .. import util
from ..sql import coercions
from ..sql import roles
from ..sql.base import _NoArg
from ..sql.schema import Column
from ..sql.schema import SchemaConst
from ..sql.type_api import TypeEngine
from ..util.typing import de_optionalize_union_types
from ..util.typing import is_fwd_ref
from ..util.typing import is_optional_union
from ..util.typing import is_pep593
from ..util.typing import is_union
from ..util.typing import Self
from ..util.typing import typing_get_args

if TYPE_CHECKING:
    from ._typing import _IdentityKeyType
    from ._typing import _InstanceDict
    from ._typing import _ORMColumnExprArgument
    from ._typing import _RegistryType
    from .base import Mapped
    from .decl_base import _ClassScanMapperConfig
    from .mapper import Mapper
    from .session import Session
    from .state import _InstallLoaderCallableProto
    from .state import InstanceState
    from ..sql._typing import _InfoType
    from ..sql.elements import ColumnElement
    from ..sql.elements import NamedColumn
    from ..sql.operators import OperatorType
    from ..util.typing import _AnnotationScanType
    from ..util.typing import RODescriptorReference

_T = TypeVar("_T", bound=Any)
_PT = TypeVar("_PT", bound=Any)
_NC = TypeVar("_NC", bound="NamedColumn[Any]")

__all__ = [
    "ColumnProperty",
    "CompositeProperty",
    "ConcreteInheritedProperty",
    "RelationshipProperty",
    "SynonymProperty",
]


@log.class_logger
class ColumnProperty(
    _MapsColumns[_T],
    StrategizedProperty[_T],
    _IntrospectsAnnotations,
    log.Identified,
):
    """Describes an object attribute that corresponds to a table column
    or other column expression.

    Public constructor is the :func:`_orm.column_property` function.

    """

    strategy_wildcard_key = strategy_options._COLUMN_TOKEN
    inherit_cache = True
    """:meta private:"""

    _links_to_entity = False

    columns: List[NamedColumn[Any]]

    _is_polymorphic_discriminator: bool

    _mapped_by_synonym: Optional[str]

    comparator_factory: Type[PropComparator[_T]]

    __slots__ = (
        "columns",
        "group",
        "deferred",
        "instrument",
        "comparator_factory",
        "active_history",
        "expire_on_flush",
        "_creation_order",
        "_is_polymorphic_discriminator",
        "_mapped_by_synonym",
        "_deferred_column_loader",
        "_raise_column_loader",
        "_renders_in_subqueries",
        "raiseload",
    )

    def __init__(
        self,
        column: _ORMColumnExprArgument[_T],
        *additional_columns: _ORMColumnExprArgument[Any],
        attribute_options: Optional[_AttributeOptions] = None,
        group: Optional[str] = None,
        deferred: bool = False,
        raiseload: bool = False,
        comparator_factory: Optional[Type[PropComparator[_T]]] = None,
        active_history: bool = False,
        expire_on_flush: bool = True,
        info: Optional[_InfoType] = None,
        doc: Optional[str] = None,
        _instrument: bool = True,
        _assume_readonly_dc_attributes: bool = False,
    ):
        super().__init__(
            attribute_options=attribute_options,
            _assume_readonly_dc_attributes=_assume_readonly_dc_attributes,
        )
        columns = (column,) + additional_columns
        self.columns = [
            coercions.expect(roles.LabeledColumnExprRole, c) for c in columns
        ]
        self.group = group
        self.deferred = deferred
        self.raiseload = raiseload
        self.instrument = _instrument
        self.comparator_factory = (
            comparator_factory
            if comparator_factory is not None
            else self.__class__.Comparator
        )
        self.active_history = active_history
        self.expire_on_flush = expire_on_flush

        if info is not None:
            self.info.update(info)

        if doc is not None:
            self.doc = doc
        else:
            for col in reversed(self.columns):
                doc = getattr(col, "doc", None)
                if doc is not None:
                    self.doc = doc
                    break
            else:
                self.doc = None

        util.set_creation_order(self)

        self.strategy_key = (
            ("deferred", self.deferred),
            ("instrument", self.instrument),
        )
        if self.raiseload:
            self.strategy_key += (("raiseload", True),)

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
        column = self.columns[0]
        if column.key is None:
            column.key = key
        if column.name is None:
            column.name = key

    @property
    def mapper_property_to_assign(self) -> Optional[MapperProperty[_T]]:
        return self

    @property
    def columns_to_assign(self) -> List[Tuple[Column[Any], int]]:
        # mypy doesn't care about the isinstance here
        return [
            (c, 0)  # type: ignore
            for c in self.columns
            if isinstance(c, Column) and c.table is None
        ]

    def _memoized_attr__renders_in_subqueries(self) -> bool:
        if ("query_expression", True) in self.strategy_key:
            return self.strategy._have_default_expression  # type: ignore

        return ("deferred", True) not in self.strategy_key or (
            self not in self.parent._readonly_props  # type: ignore
        )

    @util.preload_module("sqlalchemy.orm.state", "sqlalchemy.orm.strategies")
    def _memoized_attr__deferred_column_loader(
        self,
    ) -> _InstallLoaderCallableProto[Any]:
        state = util.preloaded.orm_state
        strategies = util.preloaded.orm_strategies
        return state.InstanceState._instance_level_callable_processor(
            self.parent.class_manager,
            strategies.LoadDeferredColumns(self.key),
            self.key,
        )

    @util.preload_module("sqlalchemy.orm.state", "sqlalchemy.orm.strategies")
    def _memoized_attr__raise_column_loader(
        self,
    ) -> _InstallLoaderCallableProto[Any]:
        state = util.preloaded.orm_state
        strategies = util.preloaded.orm_strategies
        return state.InstanceState._instance_level_callable_processor(
            self.parent.class_manager,
            strategies.LoadDeferredColumns(self.key, True),
            self.key,
        )

    def __clause_element__(self) -> roles.ColumnsClauseRole:
        """Allow the ColumnProperty to work in expression before it is turned
        into an instrumented attribute.
        """

        return self.expression

    @property
    def expression(self) -> roles.ColumnsClauseRole:
        """Return the primary column or expression for this ColumnProperty.

        E.g.::


            class File(Base):
                # ...

                name = Column(String(64))
                extension = Column(String(8))
                filename = column_property(name + '.' + extension)
                path = column_property('C:/' + filename.expression)

        .. seealso::

            :ref:`mapper_column_property_sql_expressions_composed`

        """
        return self.columns[0]

    def instrument_class(self, mapper: Mapper[Any]) -> None:
        if not self.instrument:
            return

        attributes.register_descriptor(
            mapper.class_,
            self.key,
            comparator=self.comparator_factory(self, mapper),
            parententity=mapper,
            doc=self.doc,
        )

    def do_init(self) -> None:
        super().do_init()

        if len(self.columns) > 1 and set(self.parent.primary_key).issuperset(
            self.columns
        ):
            util.warn(
                (
                    "On mapper %s, primary key column '%s' is being combined "
                    "with distinct primary key column '%s' in attribute '%s'. "
                    "Use explicit properties to give each column its own "
                    "mapped attribute name."
                )
                % (self.parent, self.columns[1], self.columns[0], self.key)
            )

    def copy(self) -> ColumnProperty[_T]:
        return ColumnProperty(
            *self.columns,
            deferred=self.deferred,
            group=self.group,
            active_history=self.active_history,
        )

    def merge(
        self,
        session: Session,
        source_state: InstanceState[Any],
        source_dict: _InstanceDict,
        dest_state: InstanceState[Any],
        dest_dict: _InstanceDict,
        load: bool,
        _recursive: Dict[Any, object],
        _resolve_conflict_map: Dict[_IdentityKeyType[Any], object],
    ) -> None:
        if not self.instrument:
            return
        elif self.key in source_dict:
            value = source_dict[self.key]

            if not load:
                dest_dict[self.key] = value
            else:
                impl = dest_state.get_impl(self.key)
                impl.set(dest_state, dest_dict, value, None)
        elif dest_state.has_identity and self.key not in dest_dict:
            dest_state._expire_attributes(
                dest_dict, [self.key], no_loader=True
            )

    class Comparator(util.MemoizedSlots, PropComparator[_PT]):
        """Produce boolean, comparison, and other operators for
        :class:`.ColumnProperty` attributes.

        See the documentation for :class:`.PropComparator` for a brief
        overview.

        .. seealso::

            :class:`.PropComparator`

            :class:`.ColumnOperators`

            :ref:`types_operators`

            :attr:`.TypeEngine.comparator_factory`

        """

        if not TYPE_CHECKING:
            # prevent pylance from being clever about slots
            __slots__ = "__clause_element__", "info", "expressions"

        prop: RODescriptorReference[ColumnProperty[_PT]]

        expressions: Sequence[NamedColumn[Any]]
        """The full sequence of columns referenced by this
         attribute, adjusted for any aliasing in progress.

        .. versionadded:: 1.3.17

        .. seealso::

           :ref:`maptojoin` - usage example
        """

        def _orm_annotate_column(self, column: _NC) -> _NC:
            """annotate and possibly adapt a column to be returned
            as the mapped-attribute exposed version of the column.

            The column in this context needs to act as much like the
            column in an ORM mapped context as possible, so includes
            annotations to give hints to various ORM functions as to
            the source entity of this column.   It also adapts it
            to the mapper's with_polymorphic selectable if one is
            present.

            """

            pe = self._parententity
            annotations: Dict[str, Any] = {
                "entity_namespace": pe,
                "parententity": pe,
                "parentmapper": pe,
                "proxy_key": self.prop.key,
            }

            col = column

            # for a mapper with polymorphic_on and an adapter, return
            # the column against the polymorphic selectable.
            # see also orm.util._orm_downgrade_polymorphic_columns
            # for the reverse operation.
            if self._parentmapper._polymorphic_adapter:
                mapper_local_col = col
                col = self._parentmapper._polymorphic_adapter.traverse(col)

                # this is a clue to the ORM Query etc. that this column
                # was adapted to the mapper's polymorphic_adapter.  the
                # ORM uses this hint to know which column its adapting.
                annotations["adapt_column"] = mapper_local_col

            return col._annotate(annotations)._set_propagate_attrs(
                {"compile_state_plugin": "orm", "plugin_subject": pe}
            )

        if TYPE_CHECKING:

            def __clause_element__(self) -> NamedColumn[_PT]:
                ...

        def _memoized_method___clause_element__(
            self,
        ) -> NamedColumn[_PT]:
            if self.adapter:
                return self.adapter(self.prop.columns[0], self.prop.key)
            else:
                return self._orm_annotate_column(self.prop.columns[0])

        def _memoized_attr_info(self) -> _InfoType:
            """The .info dictionary for this attribute."""

            ce = self.__clause_element__()
            try:
                return ce.info  # type: ignore
            except AttributeError:
                return self.prop.info

        def _memoized_attr_expressions(self) -> Sequence[NamedColumn[Any]]:
            """The full sequence of columns referenced by this
            attribute, adjusted for any aliasing in progress.

            .. versionadded:: 1.3.17

            """
            if self.adapter:
                return [
                    self.adapter(col, self.prop.key)
                    for col in self.prop.columns
                ]
            else:
                return [
                    self._orm_annotate_column(col) for col in self.prop.columns
                ]

        def _fallback_getattr(self, key: str) -> Any:
            """proxy attribute access down to the mapped column.

            this allows user-defined comparison methods to be accessed.
            """
            return getattr(self.__clause_element__(), key)

        def operate(
            self, op: OperatorType, *other: Any, **kwargs: Any
        ) -> ColumnElement[Any]:
            return op(self.__clause_element__(), *other, **kwargs)  # type: ignore[no-any-return]  # noqa: E501

        def reverse_operate(
            self, op: OperatorType, other: Any, **kwargs: Any
        ) -> ColumnElement[Any]:
            col = self.__clause_element__()
            return op(col._bind_param(op, other), col, **kwargs)  # type: ignore[no-any-return]  # noqa: E501

    def __str__(self) -> str:
        if not self.parent or not self.key:
            return object.__repr__(self)
        return str(self.parent.class_.__name__) + "." + self.key


class MappedSQLExpression(ColumnProperty[_T], _DeclarativeMapped[_T]):
    """Declarative front-end for the :class:`.ColumnProperty` class.

    Public constructor is the :func:`_orm.column_property` function.

    .. versionchanged:: 2.0 Added :class:`_orm.MappedSQLExpression` as
       a Declarative compatible subclass for :class:`_orm.ColumnProperty`.

    .. seealso::

        :class:`.MappedColumn`

    """

    inherit_cache = True
    """:meta private:"""


class MappedColumn(
    _IntrospectsAnnotations,
    _MapsColumns[_T],
    _DeclarativeMapped[_T],
):
    """Maps a single :class:`_schema.Column` on a class.

    :class:`_orm.MappedColumn` is a specialization of the
    :class:`_orm.ColumnProperty` class and is oriented towards declarative
    configuration.

    To construct :class:`_orm.MappedColumn` objects, use the
    :func:`_orm.mapped_column` constructor function.

    .. versionadded:: 2.0


    """

    __slots__ = (
        "column",
        "_creation_order",
        "_sort_order",
        "foreign_keys",
        "_has_nullable",
        "_has_insert_default",
        "deferred",
        "deferred_group",
        "deferred_raiseload",
        "active_history",
        "_attribute_options",
        "_has_dataclass_arguments",
        "_use_existing_column",
    )

    deferred: Union[_NoArg, bool]
    deferred_raiseload: bool
    deferred_group: Optional[str]

    column: Column[_T]
    foreign_keys: Optional[Set[ForeignKey]]
    _attribute_options: _AttributeOptions

    def __init__(self, *arg: Any, **kw: Any):
        self._attribute_options = attr_opts = kw.pop(
            "attribute_options", _DEFAULT_ATTRIBUTE_OPTIONS
        )

        self._use_existing_column = kw.pop("use_existing_column", False)

        self._has_dataclass_arguments = (
            attr_opts is not None
            and attr_opts != _DEFAULT_ATTRIBUTE_OPTIONS
            and any(
                attr_opts[i] is not _NoArg.NO_ARG
                for i, attr in enumerate(attr_opts._fields)
                if attr != "dataclasses_default"
            )
        )

        insert_default = kw.pop("insert_default", _NoArg.NO_ARG)
        self._has_insert_default = insert_default is not _NoArg.NO_ARG

        if self._has_insert_default:
            kw["default"] = insert_default
        elif attr_opts.dataclasses_default is not _NoArg.NO_ARG:
            kw["default"] = attr_opts.dataclasses_default

        self.deferred_group = kw.pop("deferred_group", None)
        self.deferred_raiseload = kw.pop("deferred_raiseload", None)
        self.deferred = kw.pop("deferred", _NoArg.NO_ARG)
        self.active_history = kw.pop("active_history", False)

        self._sort_order = kw.pop("sort_order", _NoArg.NO_ARG)
        self.column = cast("Column[_T]", Column(*arg, **kw))
        self.foreign_keys = self.column.foreign_keys
        self._has_nullable = "nullable" in kw and kw.get("nullable") not in (
            None,
            SchemaConst.NULL_UNSPECIFIED,
        )
        util.set_creation_order(self)

    def _copy(self, **kw: Any) -> Self:
        new = self.__class__.__new__(self.__class__)
        new.column = self.column._copy(**kw)
        new.deferred = self.deferred
        new.deferred_group = self.deferred_group
        new.deferred_raiseload = self.deferred_raiseload
        new.foreign_keys = new.column.foreign_keys
        new.active_history = self.active_history
        new._has_nullable = self._has_nullable
        new._attribute_options = self._attribute_options
        new._has_insert_default = self._has_insert_default
        new._has_dataclass_arguments = self._has_dataclass_arguments
        new._use_existing_column = self._use_existing_column
        new._sort_order = self._sort_order
        util.set_creation_order(new)
        return new

    @property
    def name(self) -> str:
        return self.column.name

    @property
    def mapper_property_to_assign(self) -> Optional[MapperProperty[_T]]:
        effective_deferred = self.deferred
        if effective_deferred is _NoArg.NO_ARG:
            effective_deferred = bool(
                self.deferred_group or self.deferred_raiseload
            )

        if effective_deferred or self.active_history:
            return ColumnProperty(
                self.column,
                deferred=effective_deferred,
                group=self.deferred_group,
                raiseload=self.deferred_raiseload,
                attribute_options=self._attribute_options,
                active_history=self.active_history,
            )
        else:
            return None

    @property
    def columns_to_assign(self) -> List[Tuple[Column[Any], int]]:
        return [
            (
                self.column,
                self._sort_order
                if self._sort_order is not _NoArg.NO_ARG
                else 0,
            )
        ]

    def __clause_element__(self) -> Column[_T]:
        return self.column

    def operate(
        self, op: OperatorType, *other: Any, **kwargs: Any
    ) -> ColumnElement[Any]:
        return op(self.__clause_element__(), *other, **kwargs)  # type: ignore[no-any-return]  # noqa: E501

    def reverse_operate(
        self, op: OperatorType, other: Any, **kwargs: Any
    ) -> ColumnElement[Any]:
        col = self.__clause_element__()
        return op(col._bind_param(op, other), col, **kwargs)  # type: ignore[no-any-return]  # noqa: E501

    def found_in_pep593_annotated(self) -> Any:
        # return a blank mapped_column().  This mapped_column()'s
        # Column will be merged into it in _init_column_for_annotation().
        return MappedColumn()

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
        column = self.column

        if (
            self._use_existing_column
            and decl_scan.inherits
            and decl_scan.single
        ):
            if decl_scan.is_deferred:
                raise sa_exc.ArgumentError(
                    "Can't use use_existing_column with deferred mappers"
                )
            supercls_mapper = class_mapper(decl_scan.inherits, False)

            colname = column.name if column.name is not None else key
            column = self.column = supercls_mapper.local_table.c.get(  # type: ignore # noqa: E501
                colname, column
            )

        if column.key is None:
            column.key = key
        if column.name is None:
            column.name = key

        sqltype = column.type

        if extracted_mapped_annotation is None:
            if sqltype._isnull and not self.column.foreign_keys:
                self._raise_for_required(key, cls)
            else:
                return

        self._init_column_for_annotation(
            cls,
            registry,
            extracted_mapped_annotation,
            originating_module,
        )

    @util.preload_module("sqlalchemy.orm.decl_base")
    def declarative_scan_for_composite(
        self,
        registry: _RegistryType,
        cls: Type[Any],
        originating_module: Optional[str],
        key: str,
        param_name: str,
        param_annotation: _AnnotationScanType,
    ) -> None:
        decl_base = util.preloaded.orm_decl_base
        decl_base._undefer_column_name(param_name, self.column)
        self._init_column_for_annotation(
            cls, registry, param_annotation, originating_module
        )

    def _init_column_for_annotation(
        self,
        cls: Type[Any],
        registry: _RegistryType,
        argument: _AnnotationScanType,
        originating_module: Optional[str],
    ) -> None:
        sqltype = self.column.type

        if isinstance(argument, str) or is_fwd_ref(
            argument, check_generic=True
        ):
            assert originating_module is not None
            argument = de_stringify_annotation(
                cls, argument, originating_module, include_generic=True
            )

        if is_union(argument):
            assert originating_module is not None
            argument = de_stringify_union_elements(
                cls, argument, originating_module
            )

        nullable = is_optional_union(argument)

        if not self._has_nullable:
            self.column.nullable = nullable

        our_type = de_optionalize_union_types(argument)

        use_args_from = None

        if is_pep593(our_type):
            our_type_is_pep593 = True

            pep_593_components = typing_get_args(our_type)
            raw_pep_593_type = pep_593_components[0]
            if is_optional_union(raw_pep_593_type):
                raw_pep_593_type = de_optionalize_union_types(raw_pep_593_type)

                nullable = True
                if not self._has_nullable:
                    self.column.nullable = nullable
            for elem in pep_593_components[1:]:
                if isinstance(elem, MappedColumn):
                    use_args_from = elem
                    break
        else:
            our_type_is_pep593 = False
            raw_pep_593_type = None

        if use_args_from is not None:
            if (
                not self._has_insert_default
                and use_args_from.column.default is not None
            ):
                self.column.default = None

            use_args_from.column._merge(self.column)
            sqltype = self.column.type

            if (
                use_args_from.deferred is not _NoArg.NO_ARG
                and self.deferred is _NoArg.NO_ARG
            ):
                self.deferred = use_args_from.deferred

            if (
                use_args_from.deferred_group is not None
                and self.deferred_group is None
            ):
                self.deferred_group = use_args_from.deferred_group

            if (
                use_args_from.deferred_raiseload is not None
                and self.deferred_raiseload is None
            ):
                self.deferred_raiseload = use_args_from.deferred_raiseload

            if (
                use_args_from._use_existing_column
                and not self._use_existing_column
            ):
                self._use_existing_column = True

            if use_args_from.active_history:
                self.active_history = use_args_from.active_history

            if (
                use_args_from._sort_order is not None
                and self._sort_order is _NoArg.NO_ARG
            ):
                self._sort_order = use_args_from._sort_order

            if (
                use_args_from.column.key is not None
                or use_args_from.column.name is not None
            ):
                util.warn_deprecated(
                    "Can't use the 'key' or 'name' arguments in "
                    "Annotated with mapped_column(); this will be ignored",
                    "2.0.22",
                )

            if use_args_from._has_dataclass_arguments:
                for idx, arg in enumerate(
                    use_args_from._attribute_options._fields
                ):
                    if (
                        use_args_from._attribute_options[idx]
                        is not _NoArg.NO_ARG
                    ):
                        arg = arg.replace("dataclasses_", "")
                        util.warn_deprecated(
                            f"Argument '{arg}' is a dataclass argument and "
                            "cannot be specified within a mapped_column() "
                            "bundled inside of an Annotated object",
                            "2.0.22",
                        )

        if sqltype._isnull and not self.column.foreign_keys:
            new_sqltype = None

            if our_type_is_pep593:
                checks = [our_type, raw_pep_593_type]
            else:
                checks = [our_type]

            for check_type in checks:
                new_sqltype = registry._resolve_type(check_type)
                if new_sqltype is not None:
                    break
            else:
                if isinstance(our_type, TypeEngine) or (
                    isinstance(our_type, type)
                    and issubclass(our_type, TypeEngine)
                ):
                    raise sa_exc.ArgumentError(
                        f"The type provided inside the {self.column.key!r} "
                        "attribute Mapped annotation is the SQLAlchemy type "
                        f"{our_type}. Expected a Python type instead"
                    )
                else:
                    raise sa_exc.ArgumentError(
                        "Could not locate SQLAlchemy Core type for Python "
                        f"type {our_type} inside the {self.column.key!r} "
                        "attribute Mapped annotation"
                    )

            self.column._set_type(new_sqltype)
