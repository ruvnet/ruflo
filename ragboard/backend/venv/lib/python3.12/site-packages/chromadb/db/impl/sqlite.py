import logging
from chromadb.db.impl.sqlite_pool import Connection, LockPool, PerThreadPool, Pool
from chromadb.db.migrations import MigratableDB, Migration
from chromadb.config import System, Settings
import chromadb.db.base as base
from chromadb.db.mixins.embeddings_queue import SqlEmbeddingsQueue
from chromadb.db.mixins.sysdb import SqlSysDB
from chromadb.telemetry.opentelemetry import (
    OpenTelemetryClient,
    OpenTelemetryGranularity,
    trace_method,
)
import sqlite3
from overrides import override
import pypika
from typing import Sequence, cast, Optional, Type, Any
from typing_extensions import Literal
from types import TracebackType
import os
from uuid import UUID
from threading import local
from importlib_resources import files
from importlib_resources.abc import Traversable

logger = logging.getLogger(__name__)


class TxWrapper(base.TxWrapper):
    _conn: Connection
    _pool: Pool

    def __init__(self, conn_pool: Pool, stack: local):
        self._tx_stack = stack
        self._conn = conn_pool.connect()
        self._pool = conn_pool

    @override
    def __enter__(self) -> base.Cursor:
        if len(self._tx_stack.stack) == 0:
            self._conn.execute("PRAGMA case_sensitive_like = ON")
            self._conn.execute("BEGIN;")
        self._tx_stack.stack.append(self)
        return self._conn.cursor()  # type: ignore

    @override
    def __exit__(
        self,
        exc_type: Optional[Type[BaseException]],
        exc_value: Optional[BaseException],
        traceback: Optional[TracebackType],
    ) -> Literal[False]:
        self._tx_stack.stack.pop()
        if len(self._tx_stack.stack) == 0:
            if exc_type is None:
                self._conn.commit()
            else:
                self._conn.rollback()
        self._conn.cursor().close()
        self._pool.return_to_pool(self._conn)
        return False


class SqliteDB(MigratableDB, SqlEmbeddingsQueue, SqlSysDB):
    _conn_pool: Pool
    _settings: Settings
    _migration_imports: Sequence[Traversable]
    _db_file: str
    _tx_stack: local
    _is_persistent: bool

    def __init__(self, system: System):
        self._settings = system.settings
        self._migration_imports = [
            files("chromadb.migrations.embeddings_queue"),
            files("chromadb.migrations.sysdb"),
            files("chromadb.migrations.metadb"),
        ]
        self._is_persistent = self._settings.require("is_persistent")
        self._opentelemetry_client = system.require(OpenTelemetryClient)
        if not self._is_persistent:
            # In order to allow sqlite to be shared between multiple threads, we need to use a
            # URI connection string with shared cache.
            # See https://www.sqlite.org/sharedcache.html
            # https://stackoverflow.com/questions/3315046/sharing-a-memory-database-between-different-threads-in-python-using-sqlite3-pa
            self._db_file = "file::memory:?cache=shared"
            self._conn_pool = LockPool(self._db_file, is_uri=True)
        else:
            self._db_file = (
                self._settings.require("persist_directory") + "/chroma.sqlite3"
            )
            if not os.path.exists(self._db_file):
                os.makedirs(os.path.dirname(self._db_file), exist_ok=True)
            self._conn_pool = PerThreadPool(self._db_file)
        self._tx_stack = local()
        super().__init__(system)

    @trace_method("SqliteDB.start", OpenTelemetryGranularity.ALL)
    @override
    def start(self) -> None:
        super().start()
        with self.tx() as cur:
            cur.execute("PRAGMA foreign_keys = ON")
            cur.execute("PRAGMA case_sensitive_like = ON")
        self.initialize_migrations()

        if (
            # (don't attempt to access .config if migrations haven't been run)
            self._settings.require("migrations") == "apply"
            and self.config.get_parameter("automatically_purge").value is False
        ):
            logger.warning(
                "⚠️ It looks like you upgraded from a version below 0.5.6 and could benefit from vacuuming your database. Run chromadb utils vacuum --help for more information."
            )

    @trace_method("SqliteDB.stop", OpenTelemetryGranularity.ALL)
    @override
    def stop(self) -> None:
        super().stop()
        self._conn_pool.close()

    @staticmethod
    @override
    def querybuilder() -> Type[pypika.Query]:
        return pypika.Query  # type: ignore

    @staticmethod
    @override
    def parameter_format() -> str:
        return "?"

    @staticmethod
    @override
    def migration_scope() -> str:
        return "sqlite"

    @override
    def migration_dirs(self) -> Sequence[Traversable]:
        return self._migration_imports

    @override
    def tx(self) -> TxWrapper:
        if not hasattr(self._tx_stack, "stack"):
            self._tx_stack.stack = []
        return TxWrapper(self._conn_pool, stack=self._tx_stack)

    @trace_method("SqliteDB.reset_state", OpenTelemetryGranularity.ALL)
    @override
    def reset_state(self) -> None:
        if not self._settings.require("allow_reset"):
            raise ValueError(
                "Resetting the database is not allowed. Set `allow_reset` to true in the config in tests or other non-production environments where reset should be permitted."
            )
        with self.tx() as cur:
            # Drop all tables
            cur.execute(
                """
                    SELECT name FROM sqlite_master
                    WHERE type='table'
                    """
            )
            for row in cur.fetchall():
                cur.execute(f"DROP TABLE IF EXISTS {row[0]}")
        self._conn_pool.close()
        self.start()
        super().reset_state()

    @trace_method("SqliteDB.setup_migrations", OpenTelemetryGranularity.ALL)
    @override
    def setup_migrations(self) -> None:
        with self.tx() as cur:
            cur.execute(
                """
                    CREATE TABLE IF NOT EXISTS migrations (
                        dir TEXT NOT NULL,
                        version INTEGER NOT NULL,
                        filename TEXT NOT NULL,
                        sql TEXT NOT NULL,
                        hash TEXT NOT NULL,
                        PRIMARY KEY (dir, version)
                    )
                    """
            )

    @trace_method("SqliteDB.migrations_initialized", OpenTelemetryGranularity.ALL)
    @override
    def migrations_initialized(self) -> bool:
        with self.tx() as cur:
            cur.execute(
                """SELECT count(*) FROM sqlite_master
                WHERE type='table' AND name='migrations'"""
            )

            if cur.fetchone()[0] == 0:
                return False
            else:
                return True

    @trace_method("SqliteDB.db_migrations", OpenTelemetryGranularity.ALL)
    @override
    def db_migrations(self, dir: Traversable) -> Sequence[Migration]:
        with self.tx() as cur:
            cur.execute(
                """
                SELECT dir, version, filename, sql, hash
                FROM migrations
                WHERE dir = ?
                ORDER BY version ASC
                """,
                (dir.name,),
            )

            migrations = []
            for row in cur.fetchall():
                found_dir = cast(str, row[0])
                found_version = cast(int, row[1])
                found_filename = cast(str, row[2])
                found_sql = cast(str, row[3])
                found_hash = cast(str, row[4])
                migrations.append(
                    Migration(
                        dir=found_dir,
                        version=found_version,
                        filename=found_filename,
                        sql=found_sql,
                        hash=found_hash,
                        scope=self.migration_scope(),
                    )
                )
            return migrations

    @override
    def apply_migration(self, cur: base.Cursor, migration: Migration) -> None:
        cur.executescript(migration["sql"])
        cur.execute(
            """
            INSERT INTO migrations (dir, version, filename, sql, hash)
            VALUES (?, ?, ?, ?, ?)
            """,
            (
                migration["dir"],
                migration["version"],
                migration["filename"],
                migration["sql"],
                migration["hash"],
            ),
        )

    @staticmethod
    @override
    def uuid_from_db(value: Optional[Any]) -> Optional[UUID]:
        return UUID(value) if value is not None else None

    @staticmethod
    @override
    def uuid_to_db(uuid: Optional[UUID]) -> Optional[Any]:
        return str(uuid) if uuid is not None else None

    @staticmethod
    @override
    def unique_constraint_error() -> Type[BaseException]:
        return sqlite3.IntegrityError

    def vacuum(self, timeout: int = 5) -> None:
        """Runs VACUUM on the database. `timeout` is the maximum time to wait for an exclusive lock in seconds."""
        conn = self._conn_pool.connect()
        conn.execute(f"PRAGMA busy_timeout = {int(timeout) * 1000}")
        conn.execute("VACUUM")
        conn.execute(
            """
            INSERT INTO maintenance_log (operation, timestamp)
            VALUES ('vacuum', CURRENT_TIMESTAMP)
            """
        )
