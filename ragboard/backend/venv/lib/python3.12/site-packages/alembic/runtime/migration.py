# mypy: allow-untyped-defs, allow-incomplete-defs, allow-untyped-calls
# mypy: no-warn-return-any, allow-any-generics

from __future__ import annotations

from contextlib import contextmanager
from contextlib import nullcontext
import logging
import sys
from typing import Any
from typing import Callable
from typing import cast
from typing import Collection
from typing import ContextManager
from typing import Dict
from typing import Iterable
from typing import Iterator
from typing import List
from typing import Optional
from typing import Set
from typing import Tuple
from typing import TYPE_CHECKING
from typing import Union

from sqlalchemy import Column
from sqlalchemy import literal_column
from sqlalchemy import MetaData
from sqlalchemy import PrimaryKeyConstraint
from sqlalchemy import String
from sqlalchemy import Table
from sqlalchemy.engine import Engine
from sqlalchemy.engine import url as sqla_url
from sqlalchemy.engine.strategies import MockEngineStrategy

from .. import ddl
from .. import util
from ..util import sqla_compat
from ..util.compat import EncodedIO

if TYPE_CHECKING:
    from sqlalchemy.engine import Dialect
    from sqlalchemy.engine import URL
    from sqlalchemy.engine.base import Connection
    from sqlalchemy.engine.base import Transaction
    from sqlalchemy.engine.mock import MockConnection
    from sqlalchemy.sql import Executable

    from .environment import EnvironmentContext
    from ..config import Config
    from ..script.base import Script
    from ..script.base import ScriptDirectory
    from ..script.revision import _RevisionOrBase
    from ..script.revision import Revision
    from ..script.revision import RevisionMap

log = logging.getLogger(__name__)


class _ProxyTransaction:
    def __init__(self, migration_context: MigrationContext) -> None:
        self.migration_context = migration_context

    @property
    def _proxied_transaction(self) -> Optional[Transaction]:
        return self.migration_context._transaction

    def rollback(self) -> None:
        t = self._proxied_transaction
        assert t is not None
        t.rollback()
        self.migration_context._transaction = None

    def commit(self) -> None:
        t = self._proxied_transaction
        assert t is not None
        t.commit()
        self.migration_context._transaction = None

    def __enter__(self) -> _ProxyTransaction:
        return self

    def __exit__(self, type_: Any, value: Any, traceback: Any) -> None:
        if self._proxied_transaction is not None:
            self._proxied_transaction.__exit__(type_, value, traceback)
            self.migration_context._transaction = None


class MigrationContext:

    """Represent the database state made available to a migration
    script.

    :class:`.MigrationContext` is the front end to an actual
    database connection, or alternatively a string output
    stream given a particular database dialect,
    from an Alembic perspective.

    When inside the ``env.py`` script, the :class:`.MigrationContext`
    is available via the
    :meth:`.EnvironmentContext.get_context` method,
    which is available at ``alembic.context``::

        # from within env.py script
        from alembic import context

        migration_context = context.get_context()

    For usage outside of an ``env.py`` script, such as for
    utility routines that want to check the current version
    in the database, the :meth:`.MigrationContext.configure`
    method to create new :class:`.MigrationContext` objects.
    For example, to get at the current revision in the
    database using :meth:`.MigrationContext.get_current_revision`::

        # in any application, outside of an env.py script
        from alembic.migration import MigrationContext
        from sqlalchemy import create_engine

        engine = create_engine("postgresql://mydatabase")
        conn = engine.connect()

        context = MigrationContext.configure(conn)
        current_rev = context.get_current_revision()

    The above context can also be used to produce
    Alembic migration operations with an :class:`.Operations`
    instance::

        # in any application, outside of the normal Alembic environment
        from alembic.operations import Operations

        op = Operations(context)
        op.alter_column("mytable", "somecolumn", nullable=True)

    """

    def __init__(
        self,
        dialect: Dialect,
        connection: Optional[Connection],
        opts: Dict[str, Any],
        environment_context: Optional[EnvironmentContext] = None,
    ) -> None:
        self.environment_context = environment_context
        self.opts = opts
        self.dialect = dialect
        self.script: Optional[ScriptDirectory] = opts.get("script")
        as_sql: bool = opts.get("as_sql", False)
        transactional_ddl = opts.get("transactional_ddl")
        self._transaction_per_migration = opts.get(
            "transaction_per_migration", False
        )
        self.on_version_apply_callbacks = opts.get("on_version_apply", ())
        self._transaction: Optional[Transaction] = None

        if as_sql:
            self.connection = cast(
                Optional["Connection"], self._stdout_connection(connection)
            )
            assert self.connection is not None
            self._in_external_transaction = False
        else:
            self.connection = connection
            self._in_external_transaction = (
                sqla_compat._get_connection_in_transaction(connection)
            )

        self._migrations_fn: Optional[
            Callable[..., Iterable[RevisionStep]]
        ] = opts.get("fn")
        self.as_sql = as_sql

        self.purge = opts.get("purge", False)

        if "output_encoding" in opts:
            self.output_buffer = EncodedIO(
                opts.get("output_buffer")
                or sys.stdout,  # type:ignore[arg-type]
                opts["output_encoding"],
            )
        else:
            self.output_buffer = opts.get("output_buffer", sys.stdout)

        self._user_compare_type = opts.get("compare_type", True)
        self._user_compare_server_default = opts.get(
            "compare_server_default", False
        )
        self.version_table = version_table = opts.get(
            "version_table", "alembic_version"
        )
        self.version_table_schema = version_table_schema = opts.get(
            "version_table_schema", None
        )
        self._version = Table(
            version_table,
            MetaData(),
            Column("version_num", String(32), nullable=False),
            schema=version_table_schema,
        )
        if opts.get("version_table_pk", True):
            self._version.append_constraint(
                PrimaryKeyConstraint(
                    "version_num", name="%s_pkc" % version_table
                )
            )

        self._start_from_rev: Optional[str] = opts.get("starting_rev")
        self.impl = ddl.DefaultImpl.get_by_dialect(dialect)(
            dialect,
            self.connection,
            self.as_sql,
            transactional_ddl,
            self.output_buffer,
            opts,
        )
        log.info("Context impl %s.", self.impl.__class__.__name__)
        if self.as_sql:
            log.info("Generating static SQL")
        log.info(
            "Will assume %s DDL.",
            "transactional"
            if self.impl.transactional_ddl
            else "non-transactional",
        )

    @classmethod
    def configure(
        cls,
        connection: Optional[Connection] = None,
        url: Optional[Union[str, URL]] = None,
        dialect_name: Optional[str] = None,
        dialect: Optional[Dialect] = None,
        environment_context: Optional[EnvironmentContext] = None,
        dialect_opts: Optional[Dict[str, str]] = None,
        opts: Optional[Any] = None,
    ) -> MigrationContext:
        """Create a new :class:`.MigrationContext`.

        This is a factory method usually called
        by :meth:`.EnvironmentContext.configure`.

        :param connection: a :class:`~sqlalchemy.engine.Connection`
         to use for SQL execution in "online" mode.  When present,
         is also used to determine the type of dialect in use.
        :param url: a string database url, or a
         :class:`sqlalchemy.engine.url.URL` object.
         The type of dialect to be used will be derived from this if
         ``connection`` is not passed.
        :param dialect_name: string name of a dialect, such as
         "postgresql", "mssql", etc.  The type of dialect to be used will be
         derived from this if ``connection`` and ``url`` are not passed.
        :param opts: dictionary of options.  Most other options
         accepted by :meth:`.EnvironmentContext.configure` are passed via
         this dictionary.

        """
        if opts is None:
            opts = {}
        if dialect_opts is None:
            dialect_opts = {}

        if connection:
            if isinstance(connection, Engine):
                raise util.CommandError(
                    "'connection' argument to configure() is expected "
                    "to be a sqlalchemy.engine.Connection instance, "
                    "got %r" % connection,
                )

            dialect = connection.dialect
        elif url:
            url_obj = sqla_url.make_url(url)
            dialect = url_obj.get_dialect()(**dialect_opts)
        elif dialect_name:
            url_obj = sqla_url.make_url("%s://" % dialect_name)
            dialect = url_obj.get_dialect()(**dialect_opts)
        elif not dialect:
            raise Exception("Connection, url, or dialect_name is required.")
        assert dialect is not None
        return MigrationContext(dialect, connection, opts, environment_context)

    @contextmanager
    def autocommit_block(self) -> Iterator[None]:
        """Enter an "autocommit" block, for databases that support AUTOCOMMIT
        isolation levels.

        This special directive is intended to support the occasional database
        DDL or system operation that specifically has to be run outside of
        any kind of transaction block.   The PostgreSQL database platform
        is the most common target for this style of operation, as many
        of its DDL operations must be run outside of transaction blocks, even
        though the database overall supports transactional DDL.

        The method is used as a context manager within a migration script, by
        calling on :meth:`.Operations.get_context` to retrieve the
        :class:`.MigrationContext`, then invoking
        :meth:`.MigrationContext.autocommit_block` using the ``with:``
        statement::

            def upgrade():
                with op.get_context().autocommit_block():
                    op.execute("ALTER TYPE mood ADD VALUE 'soso'")

        Above, a PostgreSQL "ALTER TYPE..ADD VALUE" directive is emitted,
        which must be run outside of a transaction block at the database level.
        The :meth:`.MigrationContext.autocommit_block` method makes use of the
        SQLAlchemy ``AUTOCOMMIT`` isolation level setting, which against the
        psycogp2 DBAPI corresponds to the ``connection.autocommit`` setting,
        to ensure that the database driver is not inside of a DBAPI level
        transaction block.

        .. warning::

            As is necessary, **the database transaction preceding the block is
            unconditionally committed**.  This means that the run of migrations
            preceding the operation will be committed, before the overall
            migration operation is complete.

            It is recommended that when an application includes migrations with
            "autocommit" blocks, that
            :paramref:`.EnvironmentContext.transaction_per_migration` be used
            so that the calling environment is tuned to expect short per-file
            migrations whether or not one of them has an autocommit block.


        """
        _in_connection_transaction = self._in_connection_transaction()

        if self.impl.transactional_ddl and self.as_sql:
            self.impl.emit_commit()

        elif _in_connection_transaction:
            assert self._transaction is not None

            self._transaction.commit()
            self._transaction = None

        if not self.as_sql:
            assert self.connection is not None
            current_level = self.connection.get_isolation_level()
            base_connection = self.connection

            # in 1.3 and 1.4 non-future mode, the connection gets switched
            # out.  we can use the base connection with the new mode
            # except that it will not know it's in "autocommit" and will
            # emit deprecation warnings when an autocommit action takes
            # place.
            self.connection = (
                self.impl.connection
            ) = base_connection.execution_options(isolation_level="AUTOCOMMIT")

            # sqlalchemy future mode will "autobegin" in any case, so take
            # control of that "transaction" here
            fake_trans: Optional[Transaction] = self.connection.begin()
        else:
            fake_trans = None
        try:
            yield
        finally:
            if not self.as_sql:
                assert self.connection is not None
                if fake_trans is not None:
                    fake_trans.commit()
                self.connection.execution_options(
                    isolation_level=current_level
                )
                self.connection = self.impl.connection = base_connection

            if self.impl.transactional_ddl and self.as_sql:
                self.impl.emit_begin()

            elif _in_connection_transaction:
                assert self.connection is not None
                self._transaction = self.connection.begin()

    def begin_transaction(
        self, _per_migration: bool = False
    ) -> Union[_ProxyTransaction, ContextManager[None]]:
        """Begin a logical transaction for migration operations.

        This method is used within an ``env.py`` script to demarcate where
        the outer "transaction" for a series of migrations begins.  Example::

            def run_migrations_online():
                connectable = create_engine(...)

                with connectable.connect() as connection:
                    context.configure(
                        connection=connection, target_metadata=target_metadata
                    )

                    with context.begin_transaction():
                        context.run_migrations()

        Above, :meth:`.MigrationContext.begin_transaction` is used to demarcate
        where the outer logical transaction occurs around the
        :meth:`.MigrationContext.run_migrations` operation.

        A "Logical" transaction means that the operation may or may not
        correspond to a real database transaction.   If the target database
        supports transactional DDL (or
        :paramref:`.EnvironmentContext.configure.transactional_ddl` is true),
        the :paramref:`.EnvironmentContext.configure.transaction_per_migration`
        flag is not set, and the migration is against a real database
        connection (as opposed to using "offline" ``--sql`` mode), a real
        transaction will be started.   If ``--sql`` mode is in effect, the
        operation would instead correspond to a string such as "BEGIN" being
        emitted to the string output.

        The returned object is a Python context manager that should only be
        used in the context of a ``with:`` statement as indicated above.
        The object has no other guaranteed API features present.

        .. seealso::

            :meth:`.MigrationContext.autocommit_block`

        """

        if self._in_external_transaction:
            return nullcontext()

        if self.impl.transactional_ddl:
            transaction_now = _per_migration == self._transaction_per_migration
        else:
            transaction_now = _per_migration is True

        if not transaction_now:
            return nullcontext()

        elif not self.impl.transactional_ddl:
            assert _per_migration

            if self.as_sql:
                return nullcontext()
            else:
                # track our own notion of a "transaction block", which must be
                # committed when complete.   Don't rely upon whether or not the
                # SQLAlchemy connection reports as "in transaction"; this
                # because SQLAlchemy future connection features autobegin
                # behavior, so it may already be in a transaction from our
                # emitting of queries like "has_version_table", etc. While we
                # could track these operations as well, that leaves open the
                # possibility of new operations or other things happening in
                # the user environment that still may be triggering
                # "autobegin".

                in_transaction = self._transaction is not None

                if in_transaction:
                    return nullcontext()
                else:
                    assert self.connection is not None
                    self._transaction = (
                        sqla_compat._safe_begin_connection_transaction(
                            self.connection
                        )
                    )
                    return _ProxyTransaction(self)
        elif self.as_sql:

            @contextmanager
            def begin_commit():
                self.impl.emit_begin()
                yield
                self.impl.emit_commit()

            return begin_commit()
        else:
            assert self.connection is not None
            self._transaction = sqla_compat._safe_begin_connection_transaction(
                self.connection
            )
            return _ProxyTransaction(self)

    def get_current_revision(self) -> Optional[str]:
        """Return the current revision, usually that which is present
        in the ``alembic_version`` table in the database.

        This method intends to be used only for a migration stream that
        does not contain unmerged branches in the target database;
        if there are multiple branches present, an exception is raised.
        The :meth:`.MigrationContext.get_current_heads` should be preferred
        over this method going forward in order to be compatible with
        branch migration support.

        If this :class:`.MigrationContext` was configured in "offline"
        mode, that is with ``as_sql=True``, the ``starting_rev``
        parameter is returned instead, if any.

        """
        heads = self.get_current_heads()
        if len(heads) == 0:
            return None
        elif len(heads) > 1:
            raise util.CommandError(
                "Version table '%s' has more than one head present; "
                "please use get_current_heads()" % self.version_table
            )
        else:
            return heads[0]

    def get_current_heads(self) -> Tuple[str, ...]:
        """Return a tuple of the current 'head versions' that are represented
        in the target database.

        For a migration stream without branches, this will be a single
        value, synonymous with that of
        :meth:`.MigrationContext.get_current_revision`.   However when multiple
        unmerged branches exist within the target database, the returned tuple
        will contain a value for each head.

        If this :class:`.MigrationContext` was configured in "offline"
        mode, that is with ``as_sql=True``, the ``starting_rev``
        parameter is returned in a one-length tuple.

        If no version table is present, or if there are no revisions
        present, an empty tuple is returned.

        """
        if self.as_sql:
            start_from_rev: Any = self._start_from_rev
            if start_from_rev == "base":
                start_from_rev = None
            elif start_from_rev is not None and self.script:
                start_from_rev = [
                    self.script.get_revision(sfr).revision
                    for sfr in util.to_list(start_from_rev)
                    if sfr not in (None, "base")
                ]
            return util.to_tuple(start_from_rev, default=())
        else:
            if self._start_from_rev:
                raise util.CommandError(
                    "Can't specify current_rev to context "
                    "when using a database connection"
                )
            if not self._has_version_table():
                return ()
        assert self.connection is not None
        return tuple(
            row[0] for row in self.connection.execute(self._version.select())
        )

    def _ensure_version_table(self, purge: bool = False) -> None:
        with sqla_compat._ensure_scope_for_ddl(self.connection):
            assert self.connection is not None
            self._version.create(self.connection, checkfirst=True)
            if purge:
                assert self.connection is not None
                self.connection.execute(self._version.delete())

    def _has_version_table(self) -> bool:
        assert self.connection is not None
        return sqla_compat._connectable_has_table(
            self.connection, self.version_table, self.version_table_schema
        )

    def stamp(self, script_directory: ScriptDirectory, revision: str) -> None:
        """Stamp the version table with a specific revision.

        This method calculates those branches to which the given revision
        can apply, and updates those branches as though they were migrated
        towards that revision (either up or down).  If no current branches
        include the revision, it is added as a new branch head.

        """
        heads = self.get_current_heads()
        if not self.as_sql and not heads:
            self._ensure_version_table()
        head_maintainer = HeadMaintainer(self, heads)
        for step in script_directory._stamp_revs(revision, heads):
            head_maintainer.update_to_step(step)

    def run_migrations(self, **kw: Any) -> None:
        r"""Run the migration scripts established for this
        :class:`.MigrationContext`, if any.

        The commands in :mod:`alembic.command` will set up a function
        that is ultimately passed to the :class:`.MigrationContext`
        as the ``fn`` argument.  This function represents the "work"
        that will be done when :meth:`.MigrationContext.run_migrations`
        is called, typically from within the ``env.py`` script of the
        migration environment.  The "work function" then provides an iterable
        of version callables and other version information which
        in the case of the ``upgrade`` or ``downgrade`` commands are the
        list of version scripts to invoke.  Other commands yield nothing,
        in the case that a command wants to run some other operation
        against the database such as the ``current`` or ``stamp`` commands.

        :param \**kw: keyword arguments here will be passed to each
         migration callable, that is the ``upgrade()`` or ``downgrade()``
         method within revision scripts.

        """
        self.impl.start_migrations()

        heads: Tuple[str, ...]
        if self.purge:
            if self.as_sql:
                raise util.CommandError("Can't use --purge with --sql mode")
            self._ensure_version_table(purge=True)
            heads = ()
        else:
            heads = self.get_current_heads()

            dont_mutate = self.opts.get("dont_mutate", False)

            if not self.as_sql and not heads and not dont_mutate:
                self._ensure_version_table()

        head_maintainer = HeadMaintainer(self, heads)

        assert self._migrations_fn is not None
        for step in self._migrations_fn(heads, self):
            with self.begin_transaction(_per_migration=True):
                if self.as_sql and not head_maintainer.heads:
                    # for offline mode, include a CREATE TABLE from
                    # the base
                    assert self.connection is not None
                    self._version.create(self.connection)
                log.info("Running %s", step)
                if self.as_sql:
                    self.impl.static_output(
                        "-- Running %s" % (step.short_log,)
                    )
                step.migration_fn(**kw)

                # previously, we wouldn't stamp per migration
                # if we were in a transaction, however given the more
                # complex model that involves any number of inserts
                # and row-targeted updates and deletes, it's simpler for now
                # just to run the operations on every version
                head_maintainer.update_to_step(step)
                for callback in self.on_version_apply_callbacks:
                    callback(
                        ctx=self,
                        step=step.info,
                        heads=set(head_maintainer.heads),
                        run_args=kw,
                    )

        if self.as_sql and not head_maintainer.heads:
            assert self.connection is not None
            self._version.drop(self.connection)

    def _in_connection_transaction(self) -> bool:
        try:
            meth = self.connection.in_transaction  # type:ignore[union-attr]
        except AttributeError:
            return False
        else:
            return meth()

    def execute(
        self,
        sql: Union[Executable, str],
        execution_options: Optional[Dict[str, Any]] = None,
    ) -> None:
        """Execute a SQL construct or string statement.

        The underlying execution mechanics are used, that is
        if this is "offline mode" the SQL is written to the
        output buffer, otherwise the SQL is emitted on
        the current SQLAlchemy connection.

        """
        self.impl._exec(sql, execution_options)

    def _stdout_connection(
        self, connection: Optional[Connection]
    ) -> MockConnection:
        def dump(construct, *multiparams, **params):
            self.impl._exec(construct)

        return MockEngineStrategy.MockConnection(self.dialect, dump)

    @property
    def bind(self) -> Optional[Connection]:
        """Return the current "bind".

        In online mode, this is an instance of
        :class:`sqlalchemy.engine.Connection`, and is suitable
        for ad-hoc execution of any kind of usage described
        in SQLAlchemy Core documentation as well as
        for usage with the :meth:`sqlalchemy.schema.Table.create`
        and :meth:`sqlalchemy.schema.MetaData.create_all` methods
        of :class:`~sqlalchemy.schema.Table`,
        :class:`~sqlalchemy.schema.MetaData`.

        Note that when "standard output" mode is enabled,
        this bind will be a "mock" connection handler that cannot
        return results and is only appropriate for a very limited
        subset of commands.

        """
        return self.connection

    @property
    def config(self) -> Optional[Config]:
        """Return the :class:`.Config` used by the current environment,
        if any."""

        if self.environment_context:
            return self.environment_context.config
        else:
            return None

    def _compare_type(
        self, inspector_column: Column[Any], metadata_column: Column
    ) -> bool:
        if self._user_compare_type is False:
            return False

        if callable(self._user_compare_type):
            user_value = self._user_compare_type(
                self,
                inspector_column,
                metadata_column,
                inspector_column.type,
                metadata_column.type,
            )
            if user_value is not None:
                return user_value

        return self.impl.compare_type(inspector_column, metadata_column)

    def _compare_server_default(
        self,
        inspector_column: Column[Any],
        metadata_column: Column[Any],
        rendered_metadata_default: Optional[str],
        rendered_column_default: Optional[str],
    ) -> bool:
        if self._user_compare_server_default is False:
            return False

        if callable(self._user_compare_server_default):
            user_value = self._user_compare_server_default(
                self,
                inspector_column,
                metadata_column,
                rendered_column_default,
                metadata_column.server_default,
                rendered_metadata_default,
            )
            if user_value is not None:
                return user_value

        return self.impl.compare_server_default(
            inspector_column,
            metadata_column,
            rendered_metadata_default,
            rendered_column_default,
        )


class HeadMaintainer:
    def __init__(self, context: MigrationContext, heads: Any) -> None:
        self.context = context
        self.heads = set(heads)

    def _insert_version(self, version: str) -> None:
        assert version not in self.heads
        self.heads.add(version)

        self.context.impl._exec(
            self.context._version.insert().values(
                version_num=literal_column("'%s'" % version)
            )
        )

    def _delete_version(self, version: str) -> None:
        self.heads.remove(version)

        ret = self.context.impl._exec(
            self.context._version.delete().where(
                self.context._version.c.version_num
                == literal_column("'%s'" % version)
            )
        )

        if (
            not self.context.as_sql
            and self.context.dialect.supports_sane_rowcount
            and ret is not None
            and ret.rowcount != 1
        ):
            raise util.CommandError(
                "Online migration expected to match one "
                "row when deleting '%s' in '%s'; "
                "%d found"
                % (version, self.context.version_table, ret.rowcount)
            )

    def _update_version(self, from_: str, to_: str) -> None:
        assert to_ not in self.heads
        self.heads.remove(from_)
        self.heads.add(to_)

        ret = self.context.impl._exec(
            self.context._version.update()
            .values(version_num=literal_column("'%s'" % to_))
            .where(
                self.context._version.c.version_num
                == literal_column("'%s'" % from_)
            )
        )

        if (
            not self.context.as_sql
            and self.context.dialect.supports_sane_rowcount
            and ret is not None
            and ret.rowcount != 1
        ):
            raise util.CommandError(
                "Online migration expected to match one "
                "row when updating '%s' to '%s' in '%s'; "
                "%d found"
                % (from_, to_, self.context.version_table, ret.rowcount)
            )

    def update_to_step(self, step: Union[RevisionStep, StampStep]) -> None:
        if step.should_delete_branch(self.heads):
            vers = step.delete_version_num
            log.debug("branch delete %s", vers)
            self._delete_version(vers)
        elif step.should_create_branch(self.heads):
            vers = step.insert_version_num
            log.debug("new branch insert %s", vers)
            self._insert_version(vers)
        elif step.should_merge_branches(self.heads):
            # delete revs, update from rev, update to rev
            (
                delete_revs,
                update_from_rev,
                update_to_rev,
            ) = step.merge_branch_idents(self.heads)
            log.debug(
                "merge, delete %s, update %s to %s",
                delete_revs,
                update_from_rev,
                update_to_rev,
            )
            for delrev in delete_revs:
                self._delete_version(delrev)
            self._update_version(update_from_rev, update_to_rev)
        elif step.should_unmerge_branches(self.heads):
            (
                update_from_rev,
                update_to_rev,
                insert_revs,
            ) = step.unmerge_branch_idents(self.heads)
            log.debug(
                "unmerge, insert %s, update %s to %s",
                insert_revs,
                update_from_rev,
                update_to_rev,
            )
            for insrev in insert_revs:
                self._insert_version(insrev)
            self._update_version(update_from_rev, update_to_rev)
        else:
            from_, to_ = step.update_version_num(self.heads)
            log.debug("update %s to %s", from_, to_)
            self._update_version(from_, to_)


class MigrationInfo:
    """Exposes information about a migration step to a callback listener.

    The :class:`.MigrationInfo` object is available exclusively for the
    benefit of the :paramref:`.EnvironmentContext.on_version_apply`
    callback hook.

    """

    is_upgrade: bool
    """True/False: indicates whether this operation ascends or descends the
    version tree."""

    is_stamp: bool
    """True/False: indicates whether this operation is a stamp (i.e. whether
    it results in any actual database operations)."""

    up_revision_id: Optional[str]
    """Version string corresponding to :attr:`.Revision.revision`.

    In the case of a stamp operation, it is advised to use the
    :attr:`.MigrationInfo.up_revision_ids` tuple as a stamp operation can
    make a single movement from one or more branches down to a single
    branchpoint, in which case there will be multiple "up" revisions.

    .. seealso::

        :attr:`.MigrationInfo.up_revision_ids`

    """

    up_revision_ids: Tuple[str, ...]
    """Tuple of version strings corresponding to :attr:`.Revision.revision`.

    In the majority of cases, this tuple will be a single value, synonymous
    with the scalar value of :attr:`.MigrationInfo.up_revision_id`.
    It can be multiple revision identifiers only in the case of an
    ``alembic stamp`` operation which is moving downwards from multiple
    branches down to their common branch point.

    """

    down_revision_ids: Tuple[str, ...]
    """Tuple of strings representing the base revisions of this migration step.

    If empty, this represents a root revision; otherwise, the first item
    corresponds to :attr:`.Revision.down_revision`, and the rest are inferred
    from dependencies.
    """

    revision_map: RevisionMap
    """The revision map inside of which this operation occurs."""

    def __init__(
        self,
        revision_map: RevisionMap,
        is_upgrade: bool,
        is_stamp: bool,
        up_revisions: Union[str, Tuple[str, ...]],
        down_revisions: Union[str, Tuple[str, ...]],
    ) -> None:
        self.revision_map = revision_map
        self.is_upgrade = is_upgrade
        self.is_stamp = is_stamp
        self.up_revision_ids = util.to_tuple(up_revisions, default=())
        if self.up_revision_ids:
            self.up_revision_id = self.up_revision_ids[0]
        else:
            # this should never be the case with
            # "upgrade", "downgrade", or "stamp" as we are always
            # measuring movement in terms of at least one upgrade version
            self.up_revision_id = None
        self.down_revision_ids = util.to_tuple(down_revisions, default=())

    @property
    def is_migration(self) -> bool:
        """True/False: indicates whether this operation is a migration.

        At present this is true if and only the migration is not a stamp.
        If other operation types are added in the future, both this attribute
        and :attr:`~.MigrationInfo.is_stamp` will be false.
        """
        return not self.is_stamp

    @property
    def source_revision_ids(self) -> Tuple[str, ...]:
        """Active revisions before this migration step is applied."""
        return (
            self.down_revision_ids if self.is_upgrade else self.up_revision_ids
        )

    @property
    def destination_revision_ids(self) -> Tuple[str, ...]:
        """Active revisions after this migration step is applied."""
        return (
            self.up_revision_ids if self.is_upgrade else self.down_revision_ids
        )

    @property
    def up_revision(self) -> Optional[Revision]:
        """Get :attr:`~.MigrationInfo.up_revision_id` as
        a :class:`.Revision`.

        """
        return self.revision_map.get_revision(self.up_revision_id)

    @property
    def up_revisions(self) -> Tuple[Optional[_RevisionOrBase], ...]:
        """Get :attr:`~.MigrationInfo.up_revision_ids` as a
        :class:`.Revision`."""
        return self.revision_map.get_revisions(self.up_revision_ids)

    @property
    def down_revisions(self) -> Tuple[Optional[_RevisionOrBase], ...]:
        """Get :attr:`~.MigrationInfo.down_revision_ids` as a tuple of
        :class:`Revisions <.Revision>`."""
        return self.revision_map.get_revisions(self.down_revision_ids)

    @property
    def source_revisions(self) -> Tuple[Optional[_RevisionOrBase], ...]:
        """Get :attr:`~MigrationInfo.source_revision_ids` as a tuple of
        :class:`Revisions <.Revision>`."""
        return self.revision_map.get_revisions(self.source_revision_ids)

    @property
    def destination_revisions(self) -> Tuple[Optional[_RevisionOrBase], ...]:
        """Get :attr:`~MigrationInfo.destination_revision_ids` as a tuple of
        :class:`Revisions <.Revision>`."""
        return self.revision_map.get_revisions(self.destination_revision_ids)


class MigrationStep:
    from_revisions_no_deps: Tuple[str, ...]
    to_revisions_no_deps: Tuple[str, ...]
    is_upgrade: bool
    migration_fn: Any

    if TYPE_CHECKING:

        @property
        def doc(self) -> Optional[str]:
            ...

    @property
    def name(self) -> str:
        return self.migration_fn.__name__

    @classmethod
    def upgrade_from_script(
        cls, revision_map: RevisionMap, script: Script
    ) -> RevisionStep:
        return RevisionStep(revision_map, script, True)

    @classmethod
    def downgrade_from_script(
        cls, revision_map: RevisionMap, script: Script
    ) -> RevisionStep:
        return RevisionStep(revision_map, script, False)

    @property
    def is_downgrade(self) -> bool:
        return not self.is_upgrade

    @property
    def short_log(self) -> str:
        return "%s %s -> %s" % (
            self.name,
            util.format_as_comma(self.from_revisions_no_deps),
            util.format_as_comma(self.to_revisions_no_deps),
        )

    def __str__(self):
        if self.doc:
            return "%s %s -> %s, %s" % (
                self.name,
                util.format_as_comma(self.from_revisions_no_deps),
                util.format_as_comma(self.to_revisions_no_deps),
                self.doc,
            )
        else:
            return self.short_log


class RevisionStep(MigrationStep):
    def __init__(
        self, revision_map: RevisionMap, revision: Script, is_upgrade: bool
    ) -> None:
        self.revision_map = revision_map
        self.revision = revision
        self.is_upgrade = is_upgrade
        if is_upgrade:
            self.migration_fn = revision.module.upgrade
        else:
            self.migration_fn = revision.module.downgrade

    def __repr__(self):
        return "RevisionStep(%r, is_upgrade=%r)" % (
            self.revision.revision,
            self.is_upgrade,
        )

    def __eq__(self, other: object) -> bool:
        return (
            isinstance(other, RevisionStep)
            and other.revision == self.revision
            and self.is_upgrade == other.is_upgrade
        )

    @property
    def doc(self) -> Optional[str]:
        return self.revision.doc

    @property
    def from_revisions(self) -> Tuple[str, ...]:
        if self.is_upgrade:
            return self.revision._normalized_down_revisions
        else:
            return (self.revision.revision,)

    @property
    def from_revisions_no_deps(  # type:ignore[override]
        self,
    ) -> Tuple[str, ...]:
        if self.is_upgrade:
            return self.revision._versioned_down_revisions
        else:
            return (self.revision.revision,)

    @property
    def to_revisions(self) -> Tuple[str, ...]:
        if self.is_upgrade:
            return (self.revision.revision,)
        else:
            return self.revision._normalized_down_revisions

    @property
    def to_revisions_no_deps(  # type:ignore[override]
        self,
    ) -> Tuple[str, ...]:
        if self.is_upgrade:
            return (self.revision.revision,)
        else:
            return self.revision._versioned_down_revisions

    @property
    def _has_scalar_down_revision(self) -> bool:
        return len(self.revision._normalized_down_revisions) == 1

    def should_delete_branch(self, heads: Set[str]) -> bool:
        """A delete is when we are a. in a downgrade and b.
        we are going to the "base" or we are going to a version that
        is implied as a dependency on another version that is remaining.

        """
        if not self.is_downgrade:
            return False

        if self.revision.revision not in heads:
            return False

        downrevs = self.revision._normalized_down_revisions

        if not downrevs:
            # is a base
            return True
        else:
            # determine what the ultimate "to_revisions" for an
            # unmerge would be.  If there are none, then we're a delete.
            to_revisions = self._unmerge_to_revisions(heads)
            return not to_revisions

    def merge_branch_idents(
        self, heads: Set[str]
    ) -> Tuple[List[str], str, str]:
        other_heads = set(heads).difference(self.from_revisions)

        if other_heads:
            ancestors = {
                r.revision
                for r in self.revision_map._get_ancestor_nodes(
                    self.revision_map.get_revisions(other_heads), check=False
                )
            }
            from_revisions = list(
                set(self.from_revisions).difference(ancestors)
            )
        else:
            from_revisions = list(self.from_revisions)

        return (
            # delete revs, update from rev, update to rev
            list(from_revisions[0:-1]),
            from_revisions[-1],
            self.to_revisions[0],
        )

    def _unmerge_to_revisions(self, heads: Set[str]) -> Tuple[str, ...]:
        other_heads = set(heads).difference([self.revision.revision])
        if other_heads:
            ancestors = {
                r.revision
                for r in self.revision_map._get_ancestor_nodes(
                    self.revision_map.get_revisions(other_heads), check=False
                )
            }
            return tuple(set(self.to_revisions).difference(ancestors))
        else:
            # for each revision we plan to return, compute its ancestors
            # (excluding self), and remove those from the final output since
            # they are already accounted for.
            ancestors = {
                r.revision
                for to_revision in self.to_revisions
                for r in self.revision_map._get_ancestor_nodes(
                    self.revision_map.get_revisions(to_revision), check=False
                )
                if r.revision != to_revision
            }
            return tuple(set(self.to_revisions).difference(ancestors))

    def unmerge_branch_idents(
        self, heads: Set[str]
    ) -> Tuple[str, str, Tuple[str, ...]]:
        to_revisions = self._unmerge_to_revisions(heads)

        return (
            # update from rev, update to rev, insert revs
            self.from_revisions[0],
            to_revisions[-1],
            to_revisions[0:-1],
        )

    def should_create_branch(self, heads: Set[str]) -> bool:
        if not self.is_upgrade:
            return False

        downrevs = self.revision._normalized_down_revisions

        if not downrevs:
            # is a base
            return True
        else:
            # none of our downrevs are present, so...
            # we have to insert our version.   This is true whether
            # or not there is only one downrev, or multiple (in the latter
            # case, we're a merge point.)
            if not heads.intersection(downrevs):
                return True
            else:
                return False

    def should_merge_branches(self, heads: Set[str]) -> bool:
        if not self.is_upgrade:
            return False

        downrevs = self.revision._normalized_down_revisions

        if len(downrevs) > 1 and len(heads.intersection(downrevs)) > 1:
            return True

        return False

    def should_unmerge_branches(self, heads: Set[str]) -> bool:
        if not self.is_downgrade:
            return False

        downrevs = self.revision._normalized_down_revisions

        if self.revision.revision in heads and len(downrevs) > 1:
            return True

        return False

    def update_version_num(self, heads: Set[str]) -> Tuple[str, str]:
        if not self._has_scalar_down_revision:
            downrev = heads.intersection(
                self.revision._normalized_down_revisions
            )
            assert (
                len(downrev) == 1
            ), "Can't do an UPDATE because downrevision is ambiguous"
            down_revision = list(downrev)[0]
        else:
            down_revision = self.revision._normalized_down_revisions[0]

        if self.is_upgrade:
            return down_revision, self.revision.revision
        else:
            return self.revision.revision, down_revision

    @property
    def delete_version_num(self) -> str:
        return self.revision.revision

    @property
    def insert_version_num(self) -> str:
        return self.revision.revision

    @property
    def info(self) -> MigrationInfo:
        return MigrationInfo(
            revision_map=self.revision_map,
            up_revisions=self.revision.revision,
            down_revisions=self.revision._normalized_down_revisions,
            is_upgrade=self.is_upgrade,
            is_stamp=False,
        )


class StampStep(MigrationStep):
    def __init__(
        self,
        from_: Optional[Union[str, Collection[str]]],
        to_: Optional[Union[str, Collection[str]]],
        is_upgrade: bool,
        branch_move: bool,
        revision_map: Optional[RevisionMap] = None,
    ) -> None:
        self.from_: Tuple[str, ...] = util.to_tuple(from_, default=())
        self.to_: Tuple[str, ...] = util.to_tuple(to_, default=())
        self.is_upgrade = is_upgrade
        self.branch_move = branch_move
        self.migration_fn = self.stamp_revision
        self.revision_map = revision_map

    doc: Optional[str] = None

    def stamp_revision(self, **kw: Any) -> None:
        return None

    def __eq__(self, other):
        return (
            isinstance(other, StampStep)
            and other.from_revisions == self.from_revisions
            and other.to_revisions == self.to_revisions
            and other.branch_move == self.branch_move
            and self.is_upgrade == other.is_upgrade
        )

    @property
    def from_revisions(self):
        return self.from_

    @property
    def to_revisions(self) -> Tuple[str, ...]:
        return self.to_

    @property
    def from_revisions_no_deps(  # type:ignore[override]
        self,
    ) -> Tuple[str, ...]:
        return self.from_

    @property
    def to_revisions_no_deps(  # type:ignore[override]
        self,
    ) -> Tuple[str, ...]:
        return self.to_

    @property
    def delete_version_num(self) -> str:
        assert len(self.from_) == 1
        return self.from_[0]

    @property
    def insert_version_num(self) -> str:
        assert len(self.to_) == 1
        return self.to_[0]

    def update_version_num(self, heads: Set[str]) -> Tuple[str, str]:
        assert len(self.from_) == 1
        assert len(self.to_) == 1
        return self.from_[0], self.to_[0]

    def merge_branch_idents(
        self, heads: Union[Set[str], List[str]]
    ) -> Union[Tuple[List[Any], str, str], Tuple[List[str], str, str]]:
        return (
            # delete revs, update from rev, update to rev
            list(self.from_[0:-1]),
            self.from_[-1],
            self.to_[0],
        )

    def unmerge_branch_idents(
        self, heads: Set[str]
    ) -> Tuple[str, str, List[str]]:
        return (
            # update from rev, update to rev, insert revs
            self.from_[0],
            self.to_[-1],
            list(self.to_[0:-1]),
        )

    def should_delete_branch(self, heads: Set[str]) -> bool:
        # TODO: we probably need to look for self.to_ inside of heads,
        # in a similar manner as should_create_branch, however we have
        # no tests for this yet (stamp downgrades w/ branches)
        return self.is_downgrade and self.branch_move

    def should_create_branch(self, heads: Set[str]) -> Union[Set[str], bool]:
        return (
            self.is_upgrade
            and (self.branch_move or set(self.from_).difference(heads))
            and set(self.to_).difference(heads)
        )

    def should_merge_branches(self, heads: Set[str]) -> bool:
        return len(self.from_) > 1

    def should_unmerge_branches(self, heads: Set[str]) -> bool:
        return len(self.to_) > 1

    @property
    def info(self) -> MigrationInfo:
        up, down = (
            (self.to_, self.from_)
            if self.is_upgrade
            else (self.from_, self.to_)
        )
        assert self.revision_map is not None
        return MigrationInfo(
            revision_map=self.revision_map,
            up_revisions=up,
            down_revisions=down,
            is_upgrade=self.is_upgrade,
            is_stamp=True,
        )
