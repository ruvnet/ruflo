import sys
from typing import Sequence
from typing_extensions import TypedDict, NotRequired
from importlib_resources.abc import Traversable
import re
import hashlib
from chromadb.db.base import SqlDB, Cursor
from abc import abstractmethod
from chromadb.config import System, Settings
from chromadb.telemetry.opentelemetry import (
    OpenTelemetryClient,
    OpenTelemetryGranularity,
    trace_method,
)


class MigrationFile(TypedDict):
    path: NotRequired[Traversable]
    dir: str
    filename: str
    version: int
    scope: str


class Migration(MigrationFile):
    hash: str
    sql: str


class UninitializedMigrationsError(Exception):
    def __init__(self) -> None:
        super().__init__("Migrations have not been initialized")


class UnappliedMigrationsError(Exception):
    def __init__(self, dir: str, version: int):
        self.dir = dir
        self.version = version
        super().__init__(
            f"Unapplied migrations in {dir}, starting with version {version}"
        )


class InconsistentVersionError(Exception):
    def __init__(self, dir: str, db_version: int, source_version: int):
        super().__init__(
            f"Inconsistent migration versions in {dir}:"
            + f"db version was {db_version}, source version was {source_version}."
            + " Has the migration sequence been modified since being applied to the DB?"
        )


class InconsistentHashError(Exception):
    def __init__(self, path: str, db_hash: str, source_hash: str):
        super().__init__(
            f"Inconsistent hashes in {path}:"
            + f"db hash was {db_hash}, source has was {source_hash}."
            + " Was the migration file modified after being applied to the DB?"
        )


class InvalidHashError(Exception):
    def __init__(self, alg: str):
        super().__init__(f"Invalid hash algorithm specified: {alg}")


class InvalidMigrationFilename(Exception):
    pass


class MigratableDB(SqlDB):
    """Simple base class for databases which support basic migrations.

    Migrations are SQL files stored as package resources and accessed via
    importlib_resources.

    All migrations in the same directory are assumed to be dependent on previous
    migrations in the same directory, where "previous" is defined on lexographical
    ordering of filenames.

    Migrations have a ascending numeric version number and a hash of the file contents.
    When migrations are applied, the hashes of previous migrations are checked to ensure
    that the database is consistent with the source repository. If they are not, an
    error is thrown and no migrations will be applied.

    Migration files must follow the naming convention:
    <version>.<description>.<scope>.sql, where <version> is a 5-digit zero-padded
    integer, <description> is a short textual description, and <scope> is a short string
    identifying the database implementation.
    """

    _settings: Settings

    def __init__(self, system: System) -> None:
        self._settings = system.settings
        self._opentelemetry_client = system.require(OpenTelemetryClient)
        super().__init__(system)

    @staticmethod
    @abstractmethod
    def migration_scope() -> str:
        """The database implementation to use for migrations (e.g, sqlite, pgsql)"""
        pass

    @abstractmethod
    def migration_dirs(self) -> Sequence[Traversable]:
        """Directories containing the migration sequences that should be applied to this
        DB."""
        pass

    @abstractmethod
    def setup_migrations(self) -> None:
        """Idempotently creates the migrations table"""
        pass

    @abstractmethod
    def migrations_initialized(self) -> bool:
        """Return true if the migrations table exists"""
        pass

    @abstractmethod
    def db_migrations(self, dir: Traversable) -> Sequence[Migration]:
        """Return a list of all migrations already applied to this database, from the
        given source directory, in ascending order."""
        pass

    @abstractmethod
    def apply_migration(self, cur: Cursor, migration: Migration) -> None:
        """Apply a single migration to the database"""
        pass

    def initialize_migrations(self) -> None:
        """Initialize migrations for this DB"""
        migrate = self._settings.require("migrations")

        if migrate == "validate":
            self.validate_migrations()

        if migrate == "apply":
            self.apply_migrations()

    @trace_method("MigratableDB.validate_migrations", OpenTelemetryGranularity.ALL)
    def validate_migrations(self) -> None:
        """Validate all migrations and throw an exception if there are any unapplied
        migrations in the source repo."""
        if not self.migrations_initialized():
            raise UninitializedMigrationsError()
        for dir in self.migration_dirs():
            db_migrations = self.db_migrations(dir)
            source_migrations = find_migrations(
                dir,
                self.migration_scope(),
                self._settings.require("migrations_hash_algorithm"),
            )
            unapplied_migrations = verify_migration_sequence(
                db_migrations, source_migrations
            )
            if len(unapplied_migrations) > 0:
                version = unapplied_migrations[0]["version"]
                raise UnappliedMigrationsError(dir=dir.name, version=version)

    @trace_method("MigratableDB.apply_migrations", OpenTelemetryGranularity.ALL)
    def apply_migrations(self) -> None:
        """Validate existing migrations, and apply all new ones."""
        self.setup_migrations()
        for dir in self.migration_dirs():
            db_migrations = self.db_migrations(dir)
            source_migrations = find_migrations(
                dir,
                self.migration_scope(),
                self._settings.require("migrations_hash_algorithm"),
            )
            unapplied_migrations = verify_migration_sequence(
                db_migrations, source_migrations
            )
            with self.tx() as cur:
                for migration in unapplied_migrations:
                    self.apply_migration(cur, migration)


# Format is <version>-<name>.<scope>.sql
# e.g, 00001-users.sqlite.sql
filename_regex = re.compile(r"(\d+)-(.+)\.(.+)\.sql")


def _parse_migration_filename(
    dir: str, filename: str, path: Traversable
) -> MigrationFile:
    """Parse a migration filename into a MigrationFile object"""
    match = filename_regex.match(filename)
    if match is None:
        raise InvalidMigrationFilename("Invalid migration filename: " + filename)
    version, _, scope = match.groups()
    return {
        "path": path,
        "dir": dir,
        "filename": filename,
        "version": int(version),
        "scope": scope,
    }


def verify_migration_sequence(
    db_migrations: Sequence[Migration],
    source_migrations: Sequence[Migration],
) -> Sequence[Migration]:
    """Given a list of migrations already applied to a database, and a list of
    migrations from the source code, validate that the applied migrations are correct
    and match the expected migrations.

    Throws an exception if any migrations are missing, out of order, or if the source
    hash does not match.

    Returns a list of all unapplied migrations, or an empty list if all migrations are
    applied and the database is up to date."""

    for db_migration, source_migration in zip(db_migrations, source_migrations):
        if db_migration["version"] != source_migration["version"]:
            raise InconsistentVersionError(
                dir=db_migration["dir"],
                db_version=db_migration["version"],
                source_version=source_migration["version"],
            )

        if db_migration["hash"] != source_migration["hash"]:
            raise InconsistentHashError(
                path=db_migration["dir"] + "/" + db_migration["filename"],
                db_hash=db_migration["hash"],
                source_hash=source_migration["hash"],
            )

    return source_migrations[len(db_migrations) :]


def find_migrations(
    dir: Traversable, scope: str, hash_alg: str = "md5"
) -> Sequence[Migration]:
    """Return a list of all migration present in the given directory, in ascending
    order. Filter by scope."""
    files = [
        _parse_migration_filename(dir.name, t.name, t)
        for t in dir.iterdir()
        if t.name.endswith(".sql")
    ]
    files = list(filter(lambda f: f["scope"] == scope, files))
    files = sorted(files, key=lambda f: f["version"])
    return [_read_migration_file(f, hash_alg) for f in files]


def _read_migration_file(file: MigrationFile, hash_alg: str) -> Migration:
    """Read a migration file"""
    if "path" not in file or not file["path"].is_file():
        raise FileNotFoundError(
            f"No migration file found for dir {file['dir']} with filename {file['filename']} and scope {file['scope']} at version {file['version']}"
        )
    sql = file["path"].read_text()

    if hash_alg == "md5":
        hash = (
            hashlib.md5(sql.encode("utf-8"), usedforsecurity=False).hexdigest()
            if sys.version_info >= (3, 9)
            else hashlib.md5(sql.encode("utf-8")).hexdigest()
        )
    elif hash_alg == "sha256":
        hash = hashlib.sha256(sql.encode("utf-8")).hexdigest()
    else:
        raise InvalidHashError(alg=hash_alg)

    return {
        "hash": hash,
        "sql": sql,
        "dir": file["dir"],
        "filename": file["filename"],
        "version": file["version"],
        "scope": file["scope"],
    }
