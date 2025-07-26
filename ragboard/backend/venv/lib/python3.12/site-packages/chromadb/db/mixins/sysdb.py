import logging
import sys
from typing import Optional, Sequence, Any, Tuple, cast, Dict, Union, Set
from uuid import UUID
from overrides import override
from pypika import Table, Column
from itertools import groupby

from chromadb.config import DEFAULT_DATABASE, DEFAULT_TENANT, System
from chromadb.db.base import Cursor, SqlDB, ParameterValue, get_sql
from chromadb.db.system import SysDB
from chromadb.errors import (
    NotFoundError,
    UniqueConstraintError,
)
from chromadb.telemetry.opentelemetry import (
    add_attributes_to_current_span,
    OpenTelemetryClient,
    OpenTelemetryGranularity,
    trace_method,
)
from chromadb.ingest import Producer
from chromadb.types import (
    CollectionAndSegments,
    Database,
    OptionalArgument,
    Segment,
    Metadata,
    Collection,
    SegmentScope,
    Tenant,
    Unspecified,
    UpdateMetadata,
)
from chromadb.api.collection_configuration import (
    CreateCollectionConfiguration,
    UpdateCollectionConfiguration,
    create_collection_configuration_to_json_str,
    load_collection_configuration_from_json_str,
    CollectionConfiguration,
    create_collection_configuration_to_json,
    collection_configuration_to_json,
    collection_configuration_to_json_str,
    overwrite_collection_configuration,
    update_collection_configuration_from_legacy_update_metadata,
)

logger = logging.getLogger(__name__)


class SqlSysDB(SqlDB, SysDB):
    # Used only to delete log streams on collection deletion.
    # TODO: refactor to remove this dependency into a separate interface
    _producer: Producer

    def __init__(self, system: System):
        super().__init__(system)
        self._opentelemetry_client = system.require(OpenTelemetryClient)

    @trace_method("SqlSysDB.create_segment", OpenTelemetryGranularity.ALL)
    @override
    def start(self) -> None:
        super().start()
        self._producer = self._system.instance(Producer)

    @override
    def create_database(
        self, id: UUID, name: str, tenant: str = DEFAULT_TENANT
    ) -> None:
        with self.tx() as cur:
            # Get the tenant id for the tenant name and then insert the database with the id, name and tenant id
            databases = Table("databases")
            tenants = Table("tenants")
            insert_database = (
                self.querybuilder()
                .into(databases)
                .columns(databases.id, databases.name, databases.tenant_id)
                .insert(
                    ParameterValue(self.uuid_to_db(id)),
                    ParameterValue(name),
                    self.querybuilder()
                    .select(tenants.id)
                    .from_(tenants)
                    .where(tenants.id == ParameterValue(tenant)),
                )
            )
            sql, params = get_sql(insert_database, self.parameter_format())
            try:
                cur.execute(sql, params)
            except self.unique_constraint_error() as e:
                raise UniqueConstraintError(
                    f"Database {name} already exists for tenant {tenant}"
                ) from e

    @override
    def get_database(self, name: str, tenant: str = DEFAULT_TENANT) -> Database:
        with self.tx() as cur:
            databases = Table("databases")
            q = (
                self.querybuilder()
                .from_(databases)
                .select(databases.id, databases.name)
                .where(databases.name == ParameterValue(name))
                .where(databases.tenant_id == ParameterValue(tenant))
            )
            sql, params = get_sql(q, self.parameter_format())
            row = cur.execute(sql, params).fetchone()
            if not row:
                raise NotFoundError(
                    f"Database {name} not found for tenant {tenant}. Are you sure it exists?"
                )
            if row[0] is None:
                raise NotFoundError(
                    f"Database {name} not found for tenant {tenant}. Are you sure it exists?"
                )
            id: UUID = cast(UUID, self.uuid_from_db(row[0]))
            return Database(
                id=id,
                name=row[1],
                tenant=tenant,
            )

    @override
    def delete_database(self, name: str, tenant: str = DEFAULT_TENANT) -> None:
        with self.tx() as cur:
            databases = Table("databases")
            q = (
                self.querybuilder()
                .from_(databases)
                .where(databases.name == ParameterValue(name))
                .where(databases.tenant_id == ParameterValue(tenant))
                .delete()
            )
            sql, params = get_sql(q, self.parameter_format())
            sql = sql + " RETURNING id"
            result = cur.execute(sql, params).fetchone()
            if not result:
                raise NotFoundError(f"Database {name} not found for tenant {tenant}")

            # As of 01/09/2025, cascading deletes don't work because foreign keys are not enabled.
            # See https://github.com/chroma-core/chroma/issues/3456.
            collections = Table("collections")
            q = (
                self.querybuilder()
                .from_(collections)
                .where(collections.database_id == ParameterValue(result[0]))
                .delete()
            )
            sql, params = get_sql(q, self.parameter_format())
            cur.execute(sql, params)

    @override
    def list_databases(
        self,
        limit: Optional[int] = None,
        offset: Optional[int] = None,
        tenant: str = DEFAULT_TENANT,
    ) -> Sequence[Database]:
        with self.tx() as cur:
            databases = Table("databases")
            q = (
                self.querybuilder()
                .from_(databases)
                .select(databases.id, databases.name)
                .where(databases.tenant_id == ParameterValue(tenant))
                .offset(offset)
                .limit(
                    sys.maxsize if limit is None else limit
                )  # SQLite requires that a limit is provided to use offset
                .orderby(databases.created_at)
            )
            sql, params = get_sql(q, self.parameter_format())
            rows = cur.execute(sql, params).fetchall()
            return [
                Database(
                    id=cast(UUID, self.uuid_from_db(row[0])),
                    name=row[1],
                    tenant=tenant,
                )
                for row in rows
            ]

    @override
    def create_tenant(self, name: str) -> None:
        with self.tx() as cur:
            tenants = Table("tenants")
            insert_tenant = (
                self.querybuilder()
                .into(tenants)
                .columns(tenants.id)
                .insert(ParameterValue(name))
            )
            sql, params = get_sql(insert_tenant, self.parameter_format())
            try:
                cur.execute(sql, params)
            except self.unique_constraint_error() as e:
                raise UniqueConstraintError(f"Tenant {name} already exists") from e

    @override
    def get_tenant(self, name: str) -> Tenant:
        with self.tx() as cur:
            tenants = Table("tenants")
            q = (
                self.querybuilder()
                .from_(tenants)
                .select(tenants.id)
                .where(tenants.id == ParameterValue(name))
            )
            sql, params = get_sql(q, self.parameter_format())
            row = cur.execute(sql, params).fetchone()
            if not row:
                raise NotFoundError(f"Tenant {name} not found")
            return Tenant(name=name)

    # Create a segment using the passed cursor, so that the other changes
    # can be in the same transaction.
    def create_segment_with_tx(self, cur: Cursor, segment: Segment) -> None:
        add_attributes_to_current_span(
            {
                "segment_id": str(segment["id"]),
                "segment_type": segment["type"],
                "segment_scope": segment["scope"].value,
                "collection": str(segment["collection"]),
            }
        )

        segments = Table("segments")
        insert_segment = (
            self.querybuilder()
            .into(segments)
            .columns(
                segments.id,
                segments.type,
                segments.scope,
                segments.collection,
            )
            .insert(
                ParameterValue(self.uuid_to_db(segment["id"])),
                ParameterValue(segment["type"]),
                ParameterValue(segment["scope"].value),
                ParameterValue(self.uuid_to_db(segment["collection"])),
            )
        )
        sql, params = get_sql(insert_segment, self.parameter_format())
        try:
            cur.execute(sql, params)
        except self.unique_constraint_error() as e:
            raise UniqueConstraintError(
                f"Segment {segment['id']} already exists"
            ) from e

        # Insert segment metadata if it exists
        metadata_t = Table("segment_metadata")
        if segment["metadata"]:
            try:
                self._insert_metadata(
                    cur,
                    metadata_t,
                    metadata_t.segment_id,
                    segment["id"],
                    segment["metadata"],
                )
            except Exception as e:
                logger.error(f"Error inserting segment metadata: {e}")
                raise

    # TODO(rohit): Investigate and remove this method completely.
    @trace_method("SqlSysDB.create_segment", OpenTelemetryGranularity.ALL)
    @override
    def create_segment(self, segment: Segment) -> None:
        with self.tx() as cur:
            self.create_segment_with_tx(cur, segment)

    @trace_method("SqlSysDB.create_collection", OpenTelemetryGranularity.ALL)
    @override
    def create_collection(
        self,
        id: UUID,
        name: str,
        configuration: CreateCollectionConfiguration,
        segments: Sequence[Segment],
        metadata: Optional[Metadata] = None,
        dimension: Optional[int] = None,
        get_or_create: bool = False,
        tenant: str = DEFAULT_TENANT,
        database: str = DEFAULT_DATABASE,
    ) -> Tuple[Collection, bool]:
        if id is None and not get_or_create:
            raise ValueError("id must be specified if get_or_create is False")

        add_attributes_to_current_span(
            {
                "collection_id": str(id),
                "collection_name": name,
            }
        )

        existing = self.get_collections(name=name, tenant=tenant, database=database)
        if existing:
            if get_or_create:
                collection = existing[0]
                return (
                    self.get_collections(
                        id=collection.id, tenant=tenant, database=database
                    )[0],
                    False,
                )
            else:
                raise UniqueConstraintError(f"Collection {name} already exists")

        collection = Collection(
            id=id,
            name=name,
            configuration_json=create_collection_configuration_to_json(configuration),
            metadata=metadata,
            dimension=dimension,
            tenant=tenant,
            database=database,
            version=0,
        )

        with self.tx() as cur:
            collections = Table("collections")
            databases = Table("databases")

            insert_collection = (
                self.querybuilder()
                .into(collections)
                .columns(
                    collections.id,
                    collections.name,
                    collections.config_json_str,
                    collections.dimension,
                    collections.database_id,
                )
                .insert(
                    ParameterValue(self.uuid_to_db(collection["id"])),
                    ParameterValue(collection["name"]),
                    ParameterValue(
                        create_collection_configuration_to_json_str(configuration)
                    ),
                    ParameterValue(collection["dimension"]),
                    # Get the database id for the database with the given name and tenant
                    self.querybuilder()
                    .select(databases.id)
                    .from_(databases)
                    .where(databases.name == ParameterValue(database))
                    .where(databases.tenant_id == ParameterValue(tenant)),
                )
            )
            sql, params = get_sql(insert_collection, self.parameter_format())
            try:
                cur.execute(sql, params)
            except self.unique_constraint_error() as e:
                raise UniqueConstraintError(
                    f"Collection {collection['id']} already exists"
                ) from e
            metadata_t = Table("collection_metadata")
            if collection["metadata"]:
                self._insert_metadata(
                    cur,
                    metadata_t,
                    metadata_t.collection_id,
                    collection.id,
                    collection["metadata"],
                )

            for segment in segments:
                self.create_segment_with_tx(cur, segment)

        return collection, True

    @trace_method("SqlSysDB.get_segments", OpenTelemetryGranularity.ALL)
    @override
    def get_segments(
        self,
        collection: UUID,
        id: Optional[UUID] = None,
        type: Optional[str] = None,
        scope: Optional[SegmentScope] = None,
    ) -> Sequence[Segment]:
        add_attributes_to_current_span(
            {
                "segment_id": str(id),
                "segment_type": type if type else "",
                "segment_scope": scope.value if scope else "",
                "collection": str(collection),
            }
        )
        segments_t = Table("segments")
        metadata_t = Table("segment_metadata")
        q = (
            self.querybuilder()
            .from_(segments_t)
            .select(
                segments_t.id,
                segments_t.type,
                segments_t.scope,
                segments_t.collection,
                metadata_t.key,
                metadata_t.str_value,
                metadata_t.int_value,
                metadata_t.float_value,
                metadata_t.bool_value,
            )
            .left_join(metadata_t)
            .on(segments_t.id == metadata_t.segment_id)
            .orderby(segments_t.id)
        )
        if id:
            q = q.where(segments_t.id == ParameterValue(self.uuid_to_db(id)))
        if type:
            q = q.where(segments_t.type == ParameterValue(type))
        if scope:
            q = q.where(segments_t.scope == ParameterValue(scope.value))
        if collection:
            q = q.where(
                segments_t.collection == ParameterValue(self.uuid_to_db(collection))
            )

        with self.tx() as cur:
            sql, params = get_sql(q, self.parameter_format())
            rows = cur.execute(sql, params).fetchall()
            by_segment = groupby(rows, lambda r: cast(object, r[0]))
            segments = []
            for segment_id, segment_rows in by_segment:
                id = self.uuid_from_db(str(segment_id))
                rows = list(segment_rows)
                type = str(rows[0][1])
                scope = SegmentScope(str(rows[0][2]))
                collection = self.uuid_from_db(rows[0][3])  # type: ignore[assignment]
                metadata = self._metadata_from_rows(rows)
                segments.append(
                    Segment(
                        id=cast(UUID, id),
                        type=type,
                        scope=scope,
                        collection=collection,
                        metadata=metadata,
                        file_paths={},
                    )
                )

            return segments

    @trace_method("SqlSysDB.get_collections", OpenTelemetryGranularity.ALL)
    @override
    def get_collections(
        self,
        id: Optional[UUID] = None,
        name: Optional[str] = None,
        tenant: str = DEFAULT_TENANT,
        database: str = DEFAULT_DATABASE,
        limit: Optional[int] = None,
        offset: Optional[int] = None,
    ) -> Sequence[Collection]:
        """Get collections by name, embedding function and/or metadata"""

        if name is not None and (tenant is None or database is None):
            raise ValueError(
                "If name is specified, tenant and database must also be specified in order to uniquely identify the collection"
            )

        add_attributes_to_current_span(
            {
                "collection_id": str(id),
                "collection_name": name if name else "",
            }
        )

        collections_t = Table("collections")
        metadata_t = Table("collection_metadata")
        databases_t = Table("databases")
        q = (
            self.querybuilder()
            .from_(collections_t)
            .select(
                collections_t.id,
                collections_t.name,
                collections_t.config_json_str,
                collections_t.dimension,
                databases_t.name,
                databases_t.tenant_id,
                metadata_t.key,
                metadata_t.str_value,
                metadata_t.int_value,
                metadata_t.float_value,
                metadata_t.bool_value,
            )
            .left_join(metadata_t)
            .on(collections_t.id == metadata_t.collection_id)
            .left_join(databases_t)
            .on(collections_t.database_id == databases_t.id)
            .orderby(collections_t.id)
        )
        if id:
            q = q.where(collections_t.id == ParameterValue(self.uuid_to_db(id)))
        if name:
            q = q.where(collections_t.name == ParameterValue(name))

        # Only if we have a name, tenant and database do we need to filter databases
        # Given an id, we can uniquely identify the collection so we don't need to filter databases
        if id is None and tenant and database:
            databases_t = Table("databases")
            q = q.where(
                collections_t.database_id
                == self.querybuilder()
                .select(databases_t.id)
                .from_(databases_t)
                .where(databases_t.name == ParameterValue(database))
                .where(databases_t.tenant_id == ParameterValue(tenant))
            )
        # cant set limit and offset here because this is metadata and we havent reduced yet

        with self.tx() as cur:
            sql, params = get_sql(q, self.parameter_format())
            rows = cur.execute(sql, params).fetchall()
            by_collection = groupby(rows, lambda r: cast(object, r[0]))
            collections = []
            for collection_id, collection_rows in by_collection:
                id = self.uuid_from_db(str(collection_id))
                rows = list(collection_rows)
                name = str(rows[0][1])
                metadata = self._metadata_from_rows(rows)
                dimension = int(rows[0][3]) if rows[0][3] else None
                if rows[0][2] is not None:
                    configuration = load_collection_configuration_from_json_str(
                        rows[0][2]
                    )
                else:
                    # 07/2024: This is a legacy case where we don't have a collection
                    # configuration stored in the database. This non-destructively migrates
                    # the collection to have a configuration, and takes into account any
                    # HNSW params that might be in the existing metadata.
                    configuration = self._insert_config_from_legacy_params(
                        collection_id, metadata
                    )

                collections.append(
                    Collection(
                        id=cast(UUID, id),
                        name=name,
                        configuration_json=collection_configuration_to_json(
                            configuration
                        ),
                        metadata=metadata,
                        dimension=dimension,
                        tenant=str(rows[0][5]),
                        database=str(rows[0][4]),
                        version=0,
                    )
                )

            # apply limit and offset
            if limit is not None:
                if offset is None:
                    offset = 0
                collections = collections[offset : offset + limit]
            else:
                collections = collections[offset:]

            return collections

    @override
    def get_collection_with_segments(
        self, collection_id: UUID
    ) -> CollectionAndSegments:
        collections = self.get_collections(id=collection_id)
        if len(collections) == 0:
            raise NotFoundError(f"Collection {collection_id} does not exist.")
        return CollectionAndSegments(
            collection=collections[0],
            segments=self.get_segments(collection=collection_id),
        )

    @trace_method("SqlSysDB.delete_segment", OpenTelemetryGranularity.ALL)
    @override
    def delete_segment(self, collection: UUID, id: UUID) -> None:
        """Delete a segment from the SysDB"""
        add_attributes_to_current_span(
            {
                "segment_id": str(id),
            }
        )
        t = Table("segments")
        q = (
            self.querybuilder()
            .from_(t)
            .where(t.id == ParameterValue(self.uuid_to_db(id)))
            .delete()
        )
        with self.tx() as cur:
            # no need for explicit del from metadata table because of ON DELETE CASCADE
            sql, params = get_sql(q, self.parameter_format())
            sql = sql + " RETURNING id"
            result = cur.execute(sql, params).fetchone()
            if not result:
                raise NotFoundError(f"Segment {id} not found")

    # Used by delete_collection to delete all segments for a collection along with
    # the collection itself in a single transaction.
    def delete_segments_for_collection(self, cur: Cursor, collection: UUID) -> None:
        segments_t = Table("segments")
        q = (
            self.querybuilder()
            .from_(segments_t)
            .where(segments_t.collection == ParameterValue(self.uuid_to_db(collection)))
            .delete()
        )
        sql, params = get_sql(q, self.parameter_format())
        cur.execute(sql, params)

    @trace_method("SqlSysDB.delete_collection", OpenTelemetryGranularity.ALL)
    @override
    def delete_collection(
        self,
        id: UUID,
        tenant: str = DEFAULT_TENANT,
        database: str = DEFAULT_DATABASE,
    ) -> None:
        """Delete a collection and all associated segments from the SysDB. Deletes
        the log stream for this collection as well."""
        add_attributes_to_current_span(
            {
                "collection_id": str(id),
            }
        )
        t = Table("collections")
        databases_t = Table("databases")
        q = (
            self.querybuilder()
            .from_(t)
            .where(t.id == ParameterValue(self.uuid_to_db(id)))
            .where(
                t.database_id
                == self.querybuilder()
                .select(databases_t.id)
                .from_(databases_t)
                .where(databases_t.name == ParameterValue(database))
                .where(databases_t.tenant_id == ParameterValue(tenant))
            )
            .delete()
        )
        with self.tx() as cur:
            # no need for explicit del from metadata table because of ON DELETE CASCADE
            sql, params = get_sql(q, self.parameter_format())
            sql = sql + " RETURNING id"
            result = cur.execute(sql, params).fetchone()
            if not result:
                raise NotFoundError(f"Collection {id} not found")
            # Delete segments.
            self.delete_segments_for_collection(cur, id)

        self._producer.delete_log(result[0])

    @trace_method("SqlSysDB.update_segment", OpenTelemetryGranularity.ALL)
    @override
    def update_segment(
        self,
        collection: UUID,
        id: UUID,
        metadata: OptionalArgument[Optional[UpdateMetadata]] = Unspecified(),
    ) -> None:
        add_attributes_to_current_span(
            {
                "segment_id": str(id),
                "collection": str(collection),
            }
        )
        segments_t = Table("segments")
        metadata_t = Table("segment_metadata")

        q = (
            self.querybuilder()
            .update(segments_t)
            .where(segments_t.id == ParameterValue(self.uuid_to_db(id)))
            .set(segments_t.collection, ParameterValue(self.uuid_to_db(collection)))
        )

        with self.tx() as cur:
            sql, params = get_sql(q, self.parameter_format())
            if sql:  # pypika emits a blank string if nothing to do
                cur.execute(sql, params)

            if metadata is None:
                q = (
                    self.querybuilder()
                    .from_(metadata_t)
                    .where(metadata_t.segment_id == ParameterValue(self.uuid_to_db(id)))
                    .delete()
                )
                sql, params = get_sql(q, self.parameter_format())
                cur.execute(sql, params)
            elif metadata != Unspecified():
                metadata = cast(UpdateMetadata, metadata)
                metadata = cast(UpdateMetadata, metadata)
                self._insert_metadata(
                    cur,
                    metadata_t,
                    metadata_t.segment_id,
                    id,
                    metadata,
                    set(metadata.keys()),
                )

    @trace_method("SqlSysDB.update_collection", OpenTelemetryGranularity.ALL)
    @override
    def update_collection(
        self,
        id: UUID,
        name: OptionalArgument[str] = Unspecified(),
        dimension: OptionalArgument[Optional[int]] = Unspecified(),
        metadata: OptionalArgument[Optional[UpdateMetadata]] = Unspecified(),
        configuration: OptionalArgument[
            Optional[UpdateCollectionConfiguration]
        ] = Unspecified(),
    ) -> None:
        add_attributes_to_current_span(
            {
                "collection_id": str(id),
            }
        )
        collections_t = Table("collections")
        metadata_t = Table("collection_metadata")

        q = (
            self.querybuilder()
            .update(collections_t)
            .where(collections_t.id == ParameterValue(self.uuid_to_db(id)))
        )

        if not name == Unspecified():
            q = q.set(collections_t.name, ParameterValue(name))

        if not dimension == Unspecified():
            q = q.set(collections_t.dimension, ParameterValue(dimension))

        with self.tx() as cur:
            sql, params = get_sql(q, self.parameter_format())
            if sql:  # pypika emits a blank string if nothing to do
                sql = sql + " RETURNING id"
                result = cur.execute(sql, params)
                if not result.fetchone():
                    raise NotFoundError(f"Collection {id} not found")

            # TODO: Update to use better semantics where it's possible to update
            # individual keys without wiping all the existing metadata.

            # For now, follow current legancy semantics where metadata is fully reset
            if metadata != Unspecified():
                q = (
                    self.querybuilder()
                    .from_(metadata_t)
                    .where(
                        metadata_t.collection_id == ParameterValue(self.uuid_to_db(id))
                    )
                    .delete()
                )
                sql, params = get_sql(q, self.parameter_format())
                cur.execute(sql, params)
                if metadata is not None:
                    metadata = cast(UpdateMetadata, metadata)
                    self._insert_metadata(
                        cur,
                        metadata_t,
                        metadata_t.collection_id,
                        id,
                        metadata,
                        set(metadata.keys()),
                    )

            if configuration != Unspecified():
                update_configuration = cast(
                    UpdateCollectionConfiguration, configuration
                )
                self._update_config_json_str(cur, update_configuration, id)
            else:
                if metadata != Unspecified():
                    metadata = cast(UpdateMetadata, metadata)
                    if metadata is not None:
                        update_configuration = (
                            update_collection_configuration_from_legacy_update_metadata(
                                metadata
                            )
                        )
                        self._update_config_json_str(cur, update_configuration, id)

    def _update_config_json_str(
        self, cur: Cursor, update_configuration: UpdateCollectionConfiguration, id: UUID
    ) -> None:
        collections_t = Table("collections")
        q = (
            self.querybuilder()
            .from_(collections_t)
            .select(collections_t.config_json_str)
            .where(collections_t.id == ParameterValue(self.uuid_to_db(id)))
        )
        sql, params = get_sql(q, self.parameter_format())
        row = cur.execute(sql, params).fetchone()
        if not row:
            raise NotFoundError(f"Collection {id} not found")
        config_json_str = row[0]
        existing_config = load_collection_configuration_from_json_str(config_json_str)
        new_config = overwrite_collection_configuration(
            existing_config, update_configuration
        )
        q = (
            self.querybuilder()
            .update(collections_t)
            .set(
                collections_t.config_json_str,
                ParameterValue(collection_configuration_to_json_str(new_config)),
            )
            .where(collections_t.id == ParameterValue(self.uuid_to_db(id)))
        )
        sql, params = get_sql(q, self.parameter_format())
        cur.execute(sql, params)

    @trace_method("SqlSysDB._metadata_from_rows", OpenTelemetryGranularity.ALL)
    def _metadata_from_rows(
        self, rows: Sequence[Tuple[Any, ...]]
    ) -> Optional[Metadata]:
        """Given SQL rows, return a metadata map (assuming that the last four columns
        are the key, str_value, int_value & float_value)"""
        add_attributes_to_current_span(
            {
                "num_rows": len(rows),
            }
        )
        metadata: Dict[str, Union[str, int, float, bool]] = {}
        for row in rows:
            key = str(row[-5])
            if row[-4] is not None:
                metadata[key] = str(row[-4])
            elif row[-3] is not None:
                metadata[key] = int(row[-3])
            elif row[-2] is not None:
                metadata[key] = float(row[-2])
            elif row[-1] is not None:
                metadata[key] = bool(row[-1])
        return metadata or None

    @trace_method("SqlSysDB._insert_metadata", OpenTelemetryGranularity.ALL)
    def _insert_metadata(
        self,
        cur: Cursor,
        table: Table,
        id_col: Column,
        id: UUID,
        metadata: UpdateMetadata,
        clear_keys: Optional[Set[str]] = None,
    ) -> None:
        # It would be cleaner to use something like ON CONFLICT UPDATE here But that is
        # very difficult to do in a portable way (e.g sqlite and postgres have
        # completely different sytnax)
        add_attributes_to_current_span(
            {
                "num_keys": len(metadata),
            }
        )
        if clear_keys:
            q = (
                self.querybuilder()
                .from_(table)
                .where(id_col == ParameterValue(self.uuid_to_db(id)))
                .where(table.key.isin([ParameterValue(k) for k in clear_keys]))
                .delete()
            )
            sql, params = get_sql(q, self.parameter_format())
            cur.execute(sql, params)

        q = (
            self.querybuilder()
            .into(table)
            .columns(
                id_col,
                table.key,
                table.str_value,
                table.int_value,
                table.float_value,
                table.bool_value,
            )
        )
        sql_id = self.uuid_to_db(id)
        for k, v in metadata.items():
            # Note: The order is important here because isinstance(v, bool)
            # and isinstance(v, int) both are true for v of bool type.
            if isinstance(v, bool):
                q = q.insert(
                    ParameterValue(sql_id),
                    ParameterValue(k),
                    None,
                    None,
                    None,
                    ParameterValue(int(v)),
                )
            elif isinstance(v, str):
                q = q.insert(
                    ParameterValue(sql_id),
                    ParameterValue(k),
                    ParameterValue(v),
                    None,
                    None,
                    None,
                )
            elif isinstance(v, int):
                q = q.insert(
                    ParameterValue(sql_id),
                    ParameterValue(k),
                    None,
                    ParameterValue(v),
                    None,
                    None,
                )
            elif isinstance(v, float):
                q = q.insert(
                    ParameterValue(sql_id),
                    ParameterValue(k),
                    None,
                    None,
                    ParameterValue(v),
                    None,
                )
            elif v is None:
                continue

        sql, params = get_sql(q, self.parameter_format())
        if sql:
            cur.execute(sql, params)

    def _insert_config_from_legacy_params(
        self, collection_id: Any, metadata: Optional[Metadata]
    ) -> CollectionConfiguration:
        """Insert the configuration from legacy metadata params into the collections table, and return the configuration object."""

        # This is a legacy case where we don't have configuration stored in the database
        # This is non-destructive, we don't delete or overwrite any keys in the metadata

        collections_t = Table("collections")

        create_collection_config = CreateCollectionConfiguration()
        # Write the configuration into the database
        configuration_json_str = create_collection_configuration_to_json_str(
            create_collection_config
        )
        q = (
            self.querybuilder()
            .update(collections_t)
            .set(
                collections_t.config_json_str,
                ParameterValue(configuration_json_str),
            )
            .where(collections_t.id == ParameterValue(collection_id))
        )
        sql, params = get_sql(q, self.parameter_format())
        with self.tx() as cur:
            cur.execute(sql, params)
        return load_collection_configuration_from_json_str(configuration_json_str)

    @override
    def get_collection_size(self, id: UUID) -> int:
        raise NotImplementedError

    @override
    def count_collections(
        self,
        tenant: str = DEFAULT_TENANT,
        database: Optional[str] = None,
    ) -> int:
        """Gets the number of collections for the (tenant, database) combination."""
        # TODO(Sanket): Implement this efficiently using a count query.
        # Note, the underlying get_collections api always requires a database
        # to be specified. In the sysdb implementation in go code, it does not
        # filter on database if it is set to "". This is a bad API and
        # should be fixed. For now, we will replicate the behavior.
        request_database: str = "" if database is None or database == "" else database
        return len(self.get_collections(tenant=tenant, database=request_database))
