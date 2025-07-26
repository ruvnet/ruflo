from __future__ import annotations

import contextlib
from typing import Any
from typing import Dict
from typing import Iterator
from typing import List
from typing import Optional
from typing import Sequence
from typing import Set
from typing import TYPE_CHECKING
from typing import Union

from sqlalchemy import inspect

from . import compare
from . import render
from .. import util
from ..operations import ops
from ..util import sqla_compat

"""Provide the 'autogenerate' feature which can produce migration operations
automatically."""

if TYPE_CHECKING:
    from sqlalchemy.engine import Connection
    from sqlalchemy.engine import Dialect
    from sqlalchemy.engine import Inspector
    from sqlalchemy.sql.schema import MetaData
    from sqlalchemy.sql.schema import SchemaItem
    from sqlalchemy.sql.schema import Table

    from ..config import Config
    from ..operations.ops import DowngradeOps
    from ..operations.ops import MigrationScript
    from ..operations.ops import UpgradeOps
    from ..runtime.environment import NameFilterParentNames
    from ..runtime.environment import NameFilterType
    from ..runtime.environment import ProcessRevisionDirectiveFn
    from ..runtime.environment import RenderItemFn
    from ..runtime.migration import MigrationContext
    from ..script.base import Script
    from ..script.base import ScriptDirectory
    from ..script.revision import _GetRevArg


def compare_metadata(context: MigrationContext, metadata: MetaData) -> Any:
    """Compare a database schema to that given in a
    :class:`~sqlalchemy.schema.MetaData` instance.

    The database connection is presented in the context
    of a :class:`.MigrationContext` object, which
    provides database connectivity as well as optional
    comparison functions to use for datatypes and
    server defaults - see the "autogenerate" arguments
    at :meth:`.EnvironmentContext.configure`
    for details on these.

    The return format is a list of "diff" directives,
    each representing individual differences::

        from alembic.migration import MigrationContext
        from alembic.autogenerate import compare_metadata
        from sqlalchemy import (
            create_engine,
            MetaData,
            Column,
            Integer,
            String,
            Table,
            text,
        )
        import pprint

        engine = create_engine("sqlite://")

        with engine.begin() as conn:
            conn.execute(
                text(
                    '''
                        create table foo (
                            id integer not null primary key,
                            old_data varchar,
                            x integer
                        )
                    '''
                )
            )
            conn.execute(text("create table bar (data varchar)"))

        metadata = MetaData()
        Table(
            "foo",
            metadata,
            Column("id", Integer, primary_key=True),
            Column("data", Integer),
            Column("x", Integer, nullable=False),
        )
        Table("bat", metadata, Column("info", String))

        mc = MigrationContext.configure(engine.connect())

        diff = compare_metadata(mc, metadata)
        pprint.pprint(diff, indent=2, width=20)

    Output::

        [
            (
                "add_table",
                Table(
                    "bat",
                    MetaData(),
                    Column("info", String(), table=<bat>),
                    schema=None,
                ),
            ),
            (
                "remove_table",
                Table(
                    "bar",
                    MetaData(),
                    Column("data", VARCHAR(), table=<bar>),
                    schema=None,
                ),
            ),
            (
                "add_column",
                None,
                "foo",
                Column("data", Integer(), table=<foo>),
            ),
            [
                (
                    "modify_nullable",
                    None,
                    "foo",
                    "x",
                    {
                        "existing_comment": None,
                        "existing_server_default": False,
                        "existing_type": INTEGER(),
                    },
                    True,
                    False,
                )
            ],
            (
                "remove_column",
                None,
                "foo",
                Column("old_data", VARCHAR(), table=<foo>),
            ),
        ]

    :param context: a :class:`.MigrationContext`
     instance.
    :param metadata: a :class:`~sqlalchemy.schema.MetaData`
     instance.

    .. seealso::

        :func:`.produce_migrations` - produces a :class:`.MigrationScript`
        structure based on metadata comparison.

    """

    migration_script = produce_migrations(context, metadata)
    assert migration_script.upgrade_ops is not None
    return migration_script.upgrade_ops.as_diffs()


def produce_migrations(
    context: MigrationContext, metadata: MetaData
) -> MigrationScript:
    """Produce a :class:`.MigrationScript` structure based on schema
    comparison.

    This function does essentially what :func:`.compare_metadata` does,
    but then runs the resulting list of diffs to produce the full
    :class:`.MigrationScript` object.   For an example of what this looks like,
    see the example in :ref:`customizing_revision`.

    .. seealso::

        :func:`.compare_metadata` - returns more fundamental "diff"
        data from comparing a schema.

    """

    autogen_context = AutogenContext(context, metadata=metadata)

    migration_script = ops.MigrationScript(
        rev_id=None,
        upgrade_ops=ops.UpgradeOps([]),
        downgrade_ops=ops.DowngradeOps([]),
    )

    compare._populate_migration_script(autogen_context, migration_script)

    return migration_script


def render_python_code(
    up_or_down_op: Union[UpgradeOps, DowngradeOps],
    sqlalchemy_module_prefix: str = "sa.",
    alembic_module_prefix: str = "op.",
    render_as_batch: bool = False,
    imports: Sequence[str] = (),
    render_item: Optional[RenderItemFn] = None,
    migration_context: Optional[MigrationContext] = None,
    user_module_prefix: Optional[str] = None,
) -> str:
    """Render Python code given an :class:`.UpgradeOps` or
    :class:`.DowngradeOps` object.

    This is a convenience function that can be used to test the
    autogenerate output of a user-defined :class:`.MigrationScript` structure.

    :param up_or_down_op: :class:`.UpgradeOps` or :class:`.DowngradeOps` object
    :param sqlalchemy_module_prefix: module prefix for SQLAlchemy objects
    :param alembic_module_prefix: module prefix for Alembic constructs
    :param render_as_batch: use "batch operations" style for rendering
    :param imports: sequence of import symbols to add
    :param render_item: callable to render items
    :param migration_context: optional :class:`.MigrationContext`
    :param user_module_prefix: optional string prefix for user-defined types

     .. versionadded:: 1.11.0

    """
    opts = {
        "sqlalchemy_module_prefix": sqlalchemy_module_prefix,
        "alembic_module_prefix": alembic_module_prefix,
        "render_item": render_item,
        "render_as_batch": render_as_batch,
        "user_module_prefix": user_module_prefix,
    }

    if migration_context is None:
        from ..runtime.migration import MigrationContext
        from sqlalchemy.engine.default import DefaultDialect

        migration_context = MigrationContext.configure(
            dialect=DefaultDialect()
        )

    autogen_context = AutogenContext(migration_context, opts=opts)
    autogen_context.imports = set(imports)
    return render._indent(
        render._render_cmd_body(up_or_down_op, autogen_context)
    )


def _render_migration_diffs(
    context: MigrationContext, template_args: Dict[Any, Any]
) -> None:
    """legacy, used by test_autogen_composition at the moment"""

    autogen_context = AutogenContext(context)

    upgrade_ops = ops.UpgradeOps([])
    compare._produce_net_changes(autogen_context, upgrade_ops)

    migration_script = ops.MigrationScript(
        rev_id=None,
        upgrade_ops=upgrade_ops,
        downgrade_ops=upgrade_ops.reverse(),
    )

    render._render_python_into_templatevars(
        autogen_context, migration_script, template_args
    )


class AutogenContext:
    """Maintains configuration and state that's specific to an
    autogenerate operation."""

    metadata: Optional[MetaData] = None
    """The :class:`~sqlalchemy.schema.MetaData` object
    representing the destination.

    This object is the one that is passed within ``env.py``
    to the :paramref:`.EnvironmentContext.configure.target_metadata`
    parameter.  It represents the structure of :class:`.Table` and other
    objects as stated in the current database model, and represents the
    destination structure for the database being examined.

    While the :class:`~sqlalchemy.schema.MetaData` object is primarily
    known as a collection of :class:`~sqlalchemy.schema.Table` objects,
    it also has an :attr:`~sqlalchemy.schema.MetaData.info` dictionary
    that may be used by end-user schemes to store additional schema-level
    objects that are to be compared in custom autogeneration schemes.

    """

    connection: Optional[Connection] = None
    """The :class:`~sqlalchemy.engine.base.Connection` object currently
    connected to the database backend being compared.

    This is obtained from the :attr:`.MigrationContext.bind` and is
    ultimately set up in the ``env.py`` script.

    """

    dialect: Optional[Dialect] = None
    """The :class:`~sqlalchemy.engine.Dialect` object currently in use.

    This is normally obtained from the
    :attr:`~sqlalchemy.engine.base.Connection.dialect` attribute.

    """

    imports: Set[str] = None  # type: ignore[assignment]
    """A ``set()`` which contains string Python import directives.

    The directives are to be rendered into the ``${imports}`` section
    of a script template.  The set is normally empty and can be modified
    within hooks such as the
    :paramref:`.EnvironmentContext.configure.render_item` hook.

    .. seealso::

        :ref:`autogen_render_types`

    """

    migration_context: MigrationContext = None  # type: ignore[assignment]
    """The :class:`.MigrationContext` established by the ``env.py`` script."""

    def __init__(
        self,
        migration_context: MigrationContext,
        metadata: Optional[MetaData] = None,
        opts: Optional[Dict[str, Any]] = None,
        autogenerate: bool = True,
    ) -> None:
        if (
            autogenerate
            and migration_context is not None
            and migration_context.as_sql
        ):
            raise util.CommandError(
                "autogenerate can't use as_sql=True as it prevents querying "
                "the database for schema information"
            )

        if opts is None:
            opts = migration_context.opts

        self.metadata = metadata = (
            opts.get("target_metadata", None) if metadata is None else metadata
        )

        if (
            autogenerate
            and metadata is None
            and migration_context is not None
            and migration_context.script is not None
        ):
            raise util.CommandError(
                "Can't proceed with --autogenerate option; environment "
                "script %s does not provide "
                "a MetaData object or sequence of objects to the context."
                % (migration_context.script.env_py_location)
            )

        include_object = opts.get("include_object", None)
        include_name = opts.get("include_name", None)

        object_filters = []
        name_filters = []
        if include_object:
            object_filters.append(include_object)
        if include_name:
            name_filters.append(include_name)

        self._object_filters = object_filters
        self._name_filters = name_filters

        self.migration_context = migration_context
        if self.migration_context is not None:
            self.connection = self.migration_context.bind
            self.dialect = self.migration_context.dialect

        self.imports = set()
        self.opts: Dict[str, Any] = opts
        self._has_batch: bool = False

    @util.memoized_property
    def inspector(self) -> Inspector:
        if self.connection is None:
            raise TypeError(
                "can't return inspector as this "
                "AutogenContext has no database connection"
            )
        return inspect(self.connection)

    @contextlib.contextmanager
    def _within_batch(self) -> Iterator[None]:
        self._has_batch = True
        yield
        self._has_batch = False

    def run_name_filters(
        self,
        name: Optional[str],
        type_: NameFilterType,
        parent_names: NameFilterParentNames,
    ) -> bool:
        """Run the context's name filters and return True if the targets
        should be part of the autogenerate operation.

        This method should be run for every kind of name encountered within the
        reflection side of an autogenerate operation, giving the environment
        the chance to filter what names should be reflected as database
        objects.  The filters here are produced directly via the
        :paramref:`.EnvironmentContext.configure.include_name` parameter.

        """
        if "schema_name" in parent_names:
            if type_ == "table":
                table_name = name
            else:
                table_name = parent_names.get("table_name", None)
            if table_name:
                schema_name = parent_names["schema_name"]
                if schema_name:
                    parent_names["schema_qualified_table_name"] = "%s.%s" % (
                        schema_name,
                        table_name,
                    )
                else:
                    parent_names["schema_qualified_table_name"] = table_name

        for fn in self._name_filters:
            if not fn(name, type_, parent_names):
                return False
        else:
            return True

    def run_object_filters(
        self,
        object_: SchemaItem,
        name: sqla_compat._ConstraintName,
        type_: NameFilterType,
        reflected: bool,
        compare_to: Optional[SchemaItem],
    ) -> bool:
        """Run the context's object filters and return True if the targets
        should be part of the autogenerate operation.

        This method should be run for every kind of object encountered within
        an autogenerate operation, giving the environment the chance
        to filter what objects should be included in the comparison.
        The filters here are produced directly via the
        :paramref:`.EnvironmentContext.configure.include_object` parameter.

        """
        for fn in self._object_filters:
            if not fn(object_, name, type_, reflected, compare_to):
                return False
        else:
            return True

    run_filters = run_object_filters

    @util.memoized_property
    def sorted_tables(self) -> List[Table]:
        """Return an aggregate of the :attr:`.MetaData.sorted_tables`
        collection(s).

        For a sequence of :class:`.MetaData` objects, this
        concatenates the :attr:`.MetaData.sorted_tables` collection
        for each individual :class:`.MetaData`  in the order of the
        sequence.  It does **not** collate the sorted tables collections.

        """
        result = []
        for m in util.to_list(self.metadata):
            result.extend(m.sorted_tables)
        return result

    @util.memoized_property
    def table_key_to_table(self) -> Dict[str, Table]:
        """Return an aggregate  of the :attr:`.MetaData.tables` dictionaries.

        The :attr:`.MetaData.tables` collection is a dictionary of table key
        to :class:`.Table`; this method aggregates the dictionary across
        multiple :class:`.MetaData` objects into one dictionary.

        Duplicate table keys are **not** supported; if two :class:`.MetaData`
        objects contain the same table key, an exception is raised.

        """
        result: Dict[str, Table] = {}
        for m in util.to_list(self.metadata):
            intersect = set(result).intersection(set(m.tables))
            if intersect:
                raise ValueError(
                    "Duplicate table keys across multiple "
                    "MetaData objects: %s"
                    % (", ".join('"%s"' % key for key in sorted(intersect)))
                )

            result.update(m.tables)
        return result


class RevisionContext:
    """Maintains configuration and state that's specific to a revision
    file generation operation."""

    generated_revisions: List[MigrationScript]
    process_revision_directives: Optional[ProcessRevisionDirectiveFn]

    def __init__(
        self,
        config: Config,
        script_directory: ScriptDirectory,
        command_args: Dict[str, Any],
        process_revision_directives: Optional[
            ProcessRevisionDirectiveFn
        ] = None,
    ) -> None:
        self.config = config
        self.script_directory = script_directory
        self.command_args = command_args
        self.process_revision_directives = process_revision_directives
        self.template_args = {
            "config": config  # Let templates use config for
            # e.g. multiple databases
        }
        self.generated_revisions = [self._default_revision()]

    def _to_script(
        self, migration_script: MigrationScript
    ) -> Optional[Script]:
        template_args: Dict[str, Any] = self.template_args.copy()

        if getattr(migration_script, "_needs_render", False):
            autogen_context = self._last_autogen_context

            # clear out existing imports if we are doing multiple
            # renders
            autogen_context.imports = set()
            if migration_script.imports:
                autogen_context.imports.update(migration_script.imports)
            render._render_python_into_templatevars(
                autogen_context, migration_script, template_args
            )

        assert migration_script.rev_id is not None
        return self.script_directory.generate_revision(
            migration_script.rev_id,
            migration_script.message,
            refresh=True,
            head=migration_script.head,
            splice=migration_script.splice,
            branch_labels=migration_script.branch_label,
            version_path=migration_script.version_path,
            depends_on=migration_script.depends_on,
            **template_args,
        )

    def run_autogenerate(
        self, rev: _GetRevArg, migration_context: MigrationContext
    ) -> None:
        self._run_environment(rev, migration_context, True)

    def run_no_autogenerate(
        self, rev: _GetRevArg, migration_context: MigrationContext
    ) -> None:
        self._run_environment(rev, migration_context, False)

    def _run_environment(
        self,
        rev: _GetRevArg,
        migration_context: MigrationContext,
        autogenerate: bool,
    ) -> None:
        if autogenerate:
            if self.command_args["sql"]:
                raise util.CommandError(
                    "Using --sql with --autogenerate does not make any sense"
                )
            if set(self.script_directory.get_revisions(rev)) != set(
                self.script_directory.get_revisions("heads")
            ):
                raise util.CommandError("Target database is not up to date.")

        upgrade_token = migration_context.opts["upgrade_token"]
        downgrade_token = migration_context.opts["downgrade_token"]

        migration_script = self.generated_revisions[-1]
        if not getattr(migration_script, "_needs_render", False):
            migration_script.upgrade_ops_list[-1].upgrade_token = upgrade_token
            migration_script.downgrade_ops_list[
                -1
            ].downgrade_token = downgrade_token
            migration_script._needs_render = True
        else:
            migration_script._upgrade_ops.append(
                ops.UpgradeOps([], upgrade_token=upgrade_token)
            )
            migration_script._downgrade_ops.append(
                ops.DowngradeOps([], downgrade_token=downgrade_token)
            )

        autogen_context = AutogenContext(
            migration_context, autogenerate=autogenerate
        )
        self._last_autogen_context: AutogenContext = autogen_context

        if autogenerate:
            compare._populate_migration_script(
                autogen_context, migration_script
            )

        if self.process_revision_directives:
            self.process_revision_directives(
                migration_context, rev, self.generated_revisions
            )

        hook = migration_context.opts["process_revision_directives"]
        if hook:
            hook(migration_context, rev, self.generated_revisions)

        for migration_script in self.generated_revisions:
            migration_script._needs_render = True

    def _default_revision(self) -> MigrationScript:
        command_args: Dict[str, Any] = self.command_args
        op = ops.MigrationScript(
            rev_id=command_args["rev_id"] or util.rev_id(),
            message=command_args["message"],
            upgrade_ops=ops.UpgradeOps([]),
            downgrade_ops=ops.DowngradeOps([]),
            head=command_args["head"],
            splice=command_args["splice"],
            branch_label=command_args["branch_label"],
            version_path=command_args["version_path"],
            depends_on=command_args["depends_on"],
        )
        return op

    def generate_scripts(self) -> Iterator[Optional[Script]]:
        for generated_revision in self.generated_revisions:
            yield self._to_script(generated_revision)
