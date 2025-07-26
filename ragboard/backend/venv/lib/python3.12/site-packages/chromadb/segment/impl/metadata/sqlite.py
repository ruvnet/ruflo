from typing import Optional, Sequence, Any, Tuple, cast, Generator, Union, Dict, List
from chromadb.segment import MetadataReader
from chromadb.ingest import Consumer
from chromadb.config import System
from chromadb.types import RequestVersionContext, Segment, InclusionExclusionOperator
from chromadb.db.impl.sqlite import SqliteDB
from overrides import override
from chromadb.db.base import (
    Cursor,
    ParameterValue,
    get_sql,
)
from chromadb.telemetry.opentelemetry import (
    OpenTelemetryClient,
    OpenTelemetryGranularity,
    trace_method,
)
from chromadb.types import (
    Where,
    WhereDocument,
    MetadataEmbeddingRecord,
    LogRecord,
    SeqId,
    Operation,
    UpdateMetadata,
    LiteralValue,
    WhereOperator,
)
from uuid import UUID
from pypika import Table, Tables
from pypika.queries import QueryBuilder
import pypika.functions as fn
from pypika.terms import Criterion
from itertools import groupby
from functools import reduce
import sqlite3

import logging

logger = logging.getLogger(__name__)


class SqliteMetadataSegment(MetadataReader):
    _consumer: Consumer
    _db: SqliteDB
    _id: UUID
    _opentelemetry_client: OpenTelemetryClient
    _collection_id: Optional[UUID]
    _subscription: Optional[UUID] = None

    def __init__(self, system: System, segment: Segment):
        self._db = system.instance(SqliteDB)
        self._consumer = system.instance(Consumer)
        self._id = segment["id"]
        self._opentelemetry_client = system.require(OpenTelemetryClient)
        self._collection_id = segment["collection"]

    @trace_method("SqliteMetadataSegment.start", OpenTelemetryGranularity.ALL)
    @override
    def start(self) -> None:
        if self._collection_id:
            seq_id = self.max_seqid()
            self._subscription = self._consumer.subscribe(
                collection_id=self._collection_id,
                consume_fn=self._write_metadata,
                start=seq_id,
            )

    @trace_method("SqliteMetadataSegment.stop", OpenTelemetryGranularity.ALL)
    @override
    def stop(self) -> None:
        if self._subscription:
            self._consumer.unsubscribe(self._subscription)

    @trace_method("SqliteMetadataSegment.max_seqid", OpenTelemetryGranularity.ALL)
    @override
    def max_seqid(self) -> SeqId:
        t = Table("max_seq_id")
        q = (
            self._db.querybuilder()
            .from_(t)
            .select(t.seq_id)
            .where(t.segment_id == ParameterValue(self._db.uuid_to_db(self._id)))
        )
        sql, params = get_sql(q)
        with self._db.tx() as cur:
            result = cur.execute(sql, params).fetchone()

            if result is None:
                return self._consumer.min_seqid()
            else:
                return cast(int, result[0])

    @trace_method("SqliteMetadataSegment.count", OpenTelemetryGranularity.ALL)
    @override
    def count(self, request_version_context: RequestVersionContext) -> int:
        embeddings_t = Table("embeddings")
        q = (
            self._db.querybuilder()
            .from_(embeddings_t)
            .where(
                embeddings_t.segment_id == ParameterValue(self._db.uuid_to_db(self._id))
            )
            .select(fn.Count(embeddings_t.id))
        )
        sql, params = get_sql(q)
        with self._db.tx() as cur:
            result = cur.execute(sql, params).fetchone()[0]
            return cast(int, result)

    @trace_method("SqliteMetadataSegment.get_metadata", OpenTelemetryGranularity.ALL)
    @override
    def get_metadata(
        self,
        request_version_context: RequestVersionContext,
        where: Optional[Where] = None,
        where_document: Optional[WhereDocument] = None,
        ids: Optional[Sequence[str]] = None,
        limit: Optional[int] = None,
        offset: Optional[int] = None,
        include_metadata: bool = True,
    ) -> Sequence[MetadataEmbeddingRecord]:
        """Query for embedding metadata."""
        embeddings_t, metadata_t, fulltext_t = Tables(
            "embeddings", "embedding_metadata", "embedding_fulltext_search"
        )

        limit = limit or 2**63 - 1
        offset = offset or 0

        if limit < 0:
            raise ValueError("Limit cannot be negative")

        select_clause = [
            embeddings_t.id,
            embeddings_t.embedding_id,
            embeddings_t.seq_id,
        ]
        if include_metadata:
            select_clause.extend(
                [
                    metadata_t.key,
                    metadata_t.string_value,
                    metadata_t.int_value,
                    metadata_t.float_value,
                    metadata_t.bool_value,
                ]
            )

        q = (
            (
                self._db.querybuilder()
                .from_(embeddings_t)
                .left_join(metadata_t)
                .on(embeddings_t.id == metadata_t.id)
            )
            .select(*select_clause)
            .orderby(embeddings_t.id)
        )

        # If there is a query that touches the metadata table, it uses
        # where and where_document filters, we treat this case seperately
        if where is not None or where_document is not None:
            metadata_q = (
                self._db.querybuilder()
                .from_(embeddings_t)
                .select(embeddings_t.id)
                .left_join(metadata_t)
                .on(embeddings_t.id == metadata_t.id)
                .orderby(embeddings_t.id)
                .where(
                    embeddings_t.segment_id
                    == ParameterValue(self._db.uuid_to_db(self._id))
                )
                .distinct()  # These are embedding ids
            )

            if where:
                metadata_q = metadata_q.where(
                    self._where_map_criterion(
                        metadata_q, where, metadata_t, embeddings_t
                    )
                )
            if where_document:
                metadata_q = metadata_q.where(
                    self._where_doc_criterion(
                        metadata_q, where_document, metadata_t, fulltext_t, embeddings_t
                    )
                )
            if ids is not None:
                metadata_q = metadata_q.where(
                    embeddings_t.embedding_id.isin(ParameterValue(ids))
                )

            metadata_q = metadata_q.limit(limit)
            metadata_q = metadata_q.offset(offset)

            q = q.where(embeddings_t.id.isin(metadata_q))
        else:
            # In the case where we don't use the metadata table
            # We have to apply limit/offset to embeddings and then join
            # with metadata
            embeddings_q = (
                self._db.querybuilder()
                .from_(embeddings_t)
                .select(embeddings_t.id)
                .where(
                    embeddings_t.segment_id
                    == ParameterValue(self._db.uuid_to_db(self._id))
                )
                .orderby(embeddings_t.id)
                .limit(limit)
                .offset(offset)
            )

            if ids is not None:
                embeddings_q = embeddings_q.where(
                    embeddings_t.embedding_id.isin(ParameterValue(ids))
                )

            q = q.where(embeddings_t.id.isin(embeddings_q))

        with self._db.tx() as cur:
            # Execute the query with the limit and offset already applied
            return list(self._records(cur, q, include_metadata))

    def _records(
        self, cur: Cursor, q: QueryBuilder, include_metadata: bool
    ) -> Generator[MetadataEmbeddingRecord, None, None]:
        """Given a cursor and a QueryBuilder, yield a generator of records. Assumes
        cursor returns rows in ID order."""

        sql, params = get_sql(q)
        cur.execute(sql, params)

        cur_iterator = iter(cur.fetchone, None)
        group_iterator = groupby(cur_iterator, lambda r: int(r[0]))

        for _, group in group_iterator:
            yield self._record(list(group), include_metadata)

    @trace_method("SqliteMetadataSegment._record", OpenTelemetryGranularity.ALL)
    def _record(
        self, rows: Sequence[Tuple[Any, ...]], include_metadata: bool
    ) -> MetadataEmbeddingRecord:
        """Given a list of DB rows with the same ID, construct a
        MetadataEmbeddingRecord"""
        _, embedding_id, seq_id = rows[0][:3]
        if not include_metadata:
            return MetadataEmbeddingRecord(id=embedding_id, metadata=None)

        metadata = {}
        for row in rows:
            key, string_value, int_value, float_value, bool_value = row[3:]
            if string_value is not None:
                metadata[key] = string_value
            elif int_value is not None:
                metadata[key] = int_value
            elif float_value is not None:
                metadata[key] = float_value
            elif bool_value is not None:
                if bool_value == 1:
                    metadata[key] = True
                else:
                    metadata[key] = False

        return MetadataEmbeddingRecord(
            id=embedding_id,
            metadata=metadata or None,
        )

    @trace_method("SqliteMetadataSegment._insert_record", OpenTelemetryGranularity.ALL)
    def _insert_record(self, cur: Cursor, record: LogRecord, upsert: bool) -> None:
        """Add or update a single EmbeddingRecord into the DB"""

        t = Table("embeddings")
        q = (
            self._db.querybuilder()
            .into(t)
            .columns(t.segment_id, t.embedding_id, t.seq_id)
            .where(t.segment_id == ParameterValue(self._db.uuid_to_db(self._id)))
            .where(t.embedding_id == ParameterValue(record["record"]["id"]))
        ).insert(
            ParameterValue(self._db.uuid_to_db(self._id)),
            ParameterValue(record["record"]["id"]),
            ParameterValue(record["log_offset"]),
        )
        sql, params = get_sql(q)
        sql = sql + "RETURNING id"
        try:
            id = cur.execute(sql, params).fetchone()[0]
        except sqlite3.IntegrityError:
            # Can't use INSERT OR REPLACE here because it changes the primary key.
            if upsert:
                return self._update_record(cur, record)
            else:
                logger.warning(
                    f"Insert of existing embedding ID: {record['record']['id']}"
                )
                # We are trying to add for a record that already exists. Fail the call.
                # We don't throw an exception since this is in principal an async path
                return

        if record["record"]["metadata"]:
            self._update_metadata(cur, id, record["record"]["metadata"])

    @trace_method(
        "SqliteMetadataSegment._update_metadata", OpenTelemetryGranularity.ALL
    )
    def _update_metadata(self, cur: Cursor, id: int, metadata: UpdateMetadata) -> None:
        """Update the metadata for a single EmbeddingRecord"""
        t = Table("embedding_metadata")
        to_delete = [k for k, v in metadata.items() if v is None]
        if to_delete:
            q = (
                self._db.querybuilder()
                .from_(t)
                .where(t.id == ParameterValue(id))
                .where(t.key.isin(ParameterValue(to_delete)))
                .delete()
            )
            sql, params = get_sql(q)
            cur.execute(sql, params)

        self._insert_metadata(cur, id, metadata)

    @trace_method(
        "SqliteMetadataSegment._insert_metadata", OpenTelemetryGranularity.ALL
    )
    def _insert_metadata(self, cur: Cursor, id: int, metadata: UpdateMetadata) -> None:
        """Insert or update each metadata row for a single embedding record"""
        t = Table("embedding_metadata")
        q = (
            self._db.querybuilder()
            .into(t)
            .columns(
                t.id,
                t.key,
                t.string_value,
                t.int_value,
                t.float_value,
                t.bool_value,
            )
        )
        for key, value in metadata.items():
            if isinstance(value, str):
                q = q.insert(
                    ParameterValue(id),
                    ParameterValue(key),
                    ParameterValue(value),
                    None,
                    None,
                    None,
                )
            # isinstance(True, int) evaluates to True, so we need to check for bools separately
            elif isinstance(value, bool):
                q = q.insert(
                    ParameterValue(id),
                    ParameterValue(key),
                    None,
                    None,
                    None,
                    ParameterValue(value),
                )
            elif isinstance(value, int):
                q = q.insert(
                    ParameterValue(id),
                    ParameterValue(key),
                    None,
                    ParameterValue(value),
                    None,
                    None,
                )
            elif isinstance(value, float):
                q = q.insert(
                    ParameterValue(id),
                    ParameterValue(key),
                    None,
                    None,
                    ParameterValue(value),
                    None,
                )

        sql, params = get_sql(q)
        sql = sql.replace("INSERT", "INSERT OR REPLACE")
        if sql:
            cur.execute(sql, params)

        if "chroma:document" in metadata:
            t = Table("embedding_fulltext_search")

            def insert_into_fulltext_search() -> None:
                q = (
                    self._db.querybuilder()
                    .into(t)
                    .columns(t.rowid, t.string_value)
                    .insert(
                        ParameterValue(id),
                        ParameterValue(metadata["chroma:document"]),
                    )
                )
                sql, params = get_sql(q)
                cur.execute(sql, params)

            try:
                insert_into_fulltext_search()
            except sqlite3.IntegrityError:
                q = (
                    self._db.querybuilder()
                    .from_(t)
                    .where(t.rowid == ParameterValue(id))
                    .delete()
                )
                sql, params = get_sql(q)
                cur.execute(sql, params)
                insert_into_fulltext_search()

    @trace_method("SqliteMetadataSegment._delete_record", OpenTelemetryGranularity.ALL)
    def _delete_record(self, cur: Cursor, record: LogRecord) -> None:
        """Delete a single EmbeddingRecord from the DB"""
        t = Table("embeddings")
        fts_t = Table("embedding_fulltext_search")
        q = (
            self._db.querybuilder()
            .from_(t)
            .where(t.segment_id == ParameterValue(self._db.uuid_to_db(self._id)))
            .where(t.embedding_id == ParameterValue(record["record"]["id"]))
            .delete()
        )
        q_fts = (
            self._db.querybuilder()
            .from_(fts_t)
            .delete()
            .where(
                fts_t.rowid.isin(
                    self._db.querybuilder()
                    .from_(t)
                    .select(t.id)
                    .where(
                        t.segment_id == ParameterValue(self._db.uuid_to_db(self._id))
                    )
                    .where(t.embedding_id == ParameterValue(record["record"]["id"]))
                )
            )
        )
        cur.execute(*get_sql(q_fts))
        sql, params = get_sql(q)
        sql = sql + " RETURNING id"
        result = cur.execute(sql, params).fetchone()
        if result is None:
            logger.warning(
                f"Delete of nonexisting embedding ID: {record['record']['id']}"
            )
        else:
            id = result[0]

            # Manually delete metadata; cannot use cascade because
            # that triggers on replace
            metadata_t = Table("embedding_metadata")

            q = (
                self._db.querybuilder()
                .from_(metadata_t)
                .where(metadata_t.id == ParameterValue(id))
                .delete()
            )
            sql, params = get_sql(q)
            cur.execute(sql, params)

    @trace_method("SqliteMetadataSegment._update_record", OpenTelemetryGranularity.ALL)
    def _update_record(self, cur: Cursor, record: LogRecord) -> None:
        """Update a single EmbeddingRecord in the DB"""
        t = Table("embeddings")
        q = (
            self._db.querybuilder()
            .update(t)
            .set(t.seq_id, ParameterValue(record["log_offset"]))
            .where(t.segment_id == ParameterValue(self._db.uuid_to_db(self._id)))
            .where(t.embedding_id == ParameterValue(record["record"]["id"]))
        )
        sql, params = get_sql(q)
        sql = sql + " RETURNING id"
        result = cur.execute(sql, params).fetchone()
        if result is None:
            logger.warning(
                f"Update of nonexisting embedding ID: {record['record']['id']}"
            )
        else:
            id = result[0]
            if record["record"]["metadata"]:
                self._update_metadata(cur, id, record["record"]["metadata"])

    @trace_method("SqliteMetadataSegment._write_metadata", OpenTelemetryGranularity.ALL)
    def _write_metadata(self, records: Sequence[LogRecord]) -> None:
        """Write embedding metadata to the database. Care should be taken to ensure
        records are append-only (that is, that seq-ids should increase monotonically)"""
        with self._db.tx() as cur:
            for record in records:
                if record["record"]["operation"] == Operation.ADD:
                    self._insert_record(cur, record, False)
                elif record["record"]["operation"] == Operation.UPSERT:
                    self._insert_record(cur, record, True)
                elif record["record"]["operation"] == Operation.DELETE:
                    self._delete_record(cur, record)
                elif record["record"]["operation"] == Operation.UPDATE:
                    self._update_record(cur, record)

            q = (
                self._db.querybuilder()
                .into(Table("max_seq_id"))
                .columns("segment_id", "seq_id")
                .insert(
                    ParameterValue(self._db.uuid_to_db(self._id)),
                    ParameterValue(record["log_offset"]),
                )
            )
            sql, params = get_sql(q)
            sql = sql.replace("INSERT", "INSERT OR REPLACE")
            cur.execute(sql, params)

    @trace_method(
        "SqliteMetadataSegment._where_map_criterion", OpenTelemetryGranularity.ALL
    )
    def _where_map_criterion(
        self, q: QueryBuilder, where: Where, metadata_t: Table, embeddings_t: Table
    ) -> Criterion:
        clause: List[Criterion] = []
        for k, v in where.items():
            if k == "$and":
                criteria = [
                    self._where_map_criterion(q, w, metadata_t, embeddings_t)
                    for w in cast(Sequence[Where], v)
                ]
                clause.append(reduce(lambda x, y: x & y, criteria))
            elif k == "$or":
                criteria = [
                    self._where_map_criterion(q, w, metadata_t, embeddings_t)
                    for w in cast(Sequence[Where], v)
                ]
                clause.append(reduce(lambda x, y: x | y, criteria))
            else:
                expr = cast(Union[LiteralValue, Dict[WhereOperator, LiteralValue]], v)
                clause.append(_where_clause(k, expr, q, metadata_t, embeddings_t))
        return reduce(lambda x, y: x & y, clause)

    @trace_method(
        "SqliteMetadataSegment._where_doc_criterion", OpenTelemetryGranularity.ALL
    )
    def _where_doc_criterion(
        self,
        q: QueryBuilder,
        where: WhereDocument,
        metadata_t: Table,
        fulltext_t: Table,
        embeddings_t: Table,
    ) -> Criterion:
        for k, v in where.items():
            if k == "$and":
                criteria = [
                    self._where_doc_criterion(
                        q, w, metadata_t, fulltext_t, embeddings_t
                    )
                    for w in cast(Sequence[WhereDocument], v)
                ]
                return reduce(lambda x, y: x & y, criteria)
            elif k == "$or":
                criteria = [
                    self._where_doc_criterion(
                        q, w, metadata_t, fulltext_t, embeddings_t
                    )
                    for w in cast(Sequence[WhereDocument], v)
                ]
                return reduce(lambda x, y: x | y, criteria)
            elif k in ("$contains", "$not_contains"):
                v = cast(str, v)
                search_term = f"%{v}%"

                sq = (
                    self._db.querybuilder()
                    .from_(fulltext_t)
                    .select(fulltext_t.rowid)
                    .where(fulltext_t.string_value.like(ParameterValue(search_term)))
                )
                return (
                    embeddings_t.id.isin(sq)
                    if k == "$contains"
                    else embeddings_t.id.notin(sq)
                )
            else:
                raise ValueError(f"Unknown where_doc operator {k}")
        raise ValueError("Empty where_doc")

    @trace_method("SqliteMetadataSegment.delete", OpenTelemetryGranularity.ALL)
    @override
    def delete(self) -> None:
        t = Table("embeddings")
        t1 = Table("embedding_metadata")
        t2 = Table("embedding_fulltext_search")
        q0 = (
            self._db.querybuilder()
            .from_(t1)
            .delete()
            .where(
                t1.id.isin(
                    self._db.querybuilder()
                    .from_(t)
                    .select(t.id)
                    .where(
                        t.segment_id == ParameterValue(self._db.uuid_to_db(self._id))
                    )
                )
            )
        )
        q = (
            self._db.querybuilder()
            .from_(t)
            .delete()
            .where(
                t.id.isin(
                    self._db.querybuilder()
                    .from_(t)
                    .select(t.id)
                    .where(
                        t.segment_id == ParameterValue(self._db.uuid_to_db(self._id))
                    )
                )
            )
        )
        q_fts = (
            self._db.querybuilder()
            .from_(t2)
            .delete()
            .where(
                t2.rowid.isin(
                    self._db.querybuilder()
                    .from_(t)
                    .select(t.id)
                    .where(
                        t.segment_id == ParameterValue(self._db.uuid_to_db(self._id))
                    )
                )
            )
        )
        with self._db.tx() as cur:
            cur.execute(*get_sql(q_fts))
            cur.execute(*get_sql(q0))
            cur.execute(*get_sql(q))


def _where_clause(
    key: str,
    expr: Union[
        LiteralValue,
        Dict[WhereOperator, LiteralValue],
        Dict[InclusionExclusionOperator, List[LiteralValue]],
    ],
    metadata_q: QueryBuilder,
    metadata_t: Table,
    embeddings_t: Table,
) -> Criterion:
    """Given a field name, an expression, and a table, construct a Pypika Criterion"""

    # Literal value case
    if isinstance(expr, (str, int, float, bool)):
        return _where_clause(
            key,
            {cast(WhereOperator, "$eq"): expr},
            metadata_q,
            metadata_t,
            embeddings_t,
        )

    # Operator dict case
    operator, value = next(iter(expr.items()))
    return _value_criterion(key, value, operator, metadata_q, metadata_t, embeddings_t)


def _value_criterion(
    key: str,
    value: Union[LiteralValue, List[LiteralValue]],
    op: Union[WhereOperator, InclusionExclusionOperator],
    metadata_q: QueryBuilder,
    metadata_t: Table,
    embeddings_t: Table,
) -> Criterion:
    """Creates the filter for a single operator"""

    def is_numeric(obj: object) -> bool:
        return (not isinstance(obj, bool)) and isinstance(obj, (int, float))

    sub_q = metadata_q.where(metadata_t.key == ParameterValue(key))
    p_val = ParameterValue(value)

    if is_numeric(value) or (isinstance(value, list) and is_numeric(value[0])):
        int_col, float_col = metadata_t.int_value, metadata_t.float_value
        if op in ("$eq", "$ne"):
            expr = (int_col == p_val) | (float_col == p_val)
        elif op == "$gt":
            expr = (int_col > p_val) | (float_col > p_val)
        elif op == "$gte":
            expr = (int_col >= p_val) | (float_col >= p_val)
        elif op == "$lt":
            expr = (int_col < p_val) | (float_col < p_val)
        elif op == "$lte":
            expr = (int_col <= p_val) | (float_col <= p_val)
        else:
            expr = int_col.isin(p_val) | float_col.isin(p_val)
    else:
        if isinstance(value, bool) or (
            isinstance(value, list) and isinstance(value[0], bool)
        ):
            col = metadata_t.bool_value
        else:
            col = metadata_t.string_value
        if op in ("$eq", "$ne"):
            expr = col == p_val
        else:
            expr = col.isin(p_val)

    if op in ("$ne", "$nin"):
        return embeddings_t.id.notin(sub_q.where(expr))
    else:
        return embeddings_t.id.isin(sub_q.where(expr))
