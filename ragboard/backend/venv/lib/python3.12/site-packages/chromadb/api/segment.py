from tenacity import retry, stop_after_attempt, retry_if_exception, wait_fixed
from chromadb.api import ServerAPI
from chromadb.api.collection_configuration import (
    CreateCollectionConfiguration,
    UpdateCollectionConfiguration,
    create_collection_configuration_to_json,
)
from chromadb.auth import UserIdentity
from chromadb.config import DEFAULT_DATABASE, DEFAULT_TENANT, Settings, System
from chromadb.db.system import SysDB
from chromadb.quota import QuotaEnforcer, Action
from chromadb.rate_limit import RateLimitEnforcer
from chromadb.segment import SegmentManager
from chromadb.execution.executor.abstract import Executor
from chromadb.execution.expression.operator import Scan, Filter, Limit, KNN, Projection
from chromadb.execution.expression.plan import CountPlan, GetPlan, KNNPlan
from chromadb.telemetry.opentelemetry import (
    add_attributes_to_current_span,
    OpenTelemetryClient,
    OpenTelemetryGranularity,
    trace_method,
)
from chromadb.telemetry.product import ProductTelemetryClient
from chromadb.ingest import Producer
from chromadb.types import Collection as CollectionModel
from chromadb import __version__
from chromadb.errors import (
    InvalidDimensionException,
    NotFoundError,
    VersionMismatchError,
)
from chromadb.api.types import (
    CollectionMetadata,
    IDs,
    Embeddings,
    Metadatas,
    Documents,
    URIs,
    Where,
    WhereDocument,
    Include,
    GetResult,
    QueryResult,
    validate_metadata,
    validate_update_metadata,
    validate_where,
    validate_where_document,
    validate_batch,
    IncludeMetadataDocuments,
    IncludeMetadataDocumentsDistances,
)
from chromadb.telemetry.product.events import (
    CollectionAddEvent,
    CollectionDeleteEvent,
    CollectionGetEvent,
    CollectionUpdateEvent,
    CollectionQueryEvent,
    ClientCreateCollectionEvent,
)

import chromadb.types as t
from typing import (
    Optional,
    Sequence,
    Generator,
    List,
    Any,
    Callable,
    TypeVar,
)
from overrides import override
from uuid import UUID, uuid4
from functools import wraps
import time
import logging
import re

T = TypeVar("T", bound=Callable[..., Any])

logger = logging.getLogger(__name__)


# mimics s3 bucket requirements for naming
def check_index_name(index_name: str) -> None:
    msg = (
        "Expected collection name that "
        "(1) contains 3-63 characters, "
        "(2) starts and ends with an alphanumeric character, "
        "(3) otherwise contains only alphanumeric characters, underscores or hyphens (-), "
        "(4) contains no two consecutive periods (..) and "
        "(5) is not a valid IPv4 address, "
        f"got {index_name}"
    )
    if len(index_name) < 3 or len(index_name) > 63:
        raise ValueError(msg)
    if not re.match("^[a-zA-Z0-9][a-zA-Z0-9._-]*[a-zA-Z0-9]$", index_name):
        raise ValueError(msg)
    if ".." in index_name:
        raise ValueError(msg)
    if re.match("^[0-9]{1,3}\\.[0-9]{1,3}\\.[0-9]{1,3}\\.[0-9]{1,3}$", index_name):
        raise ValueError(msg)


def rate_limit(func: T) -> T:
    @wraps(func)
    def wrapper(*args: Any, **kwargs: Any) -> Any:
        self = args[0]
        return self._rate_limit_enforcer.rate_limit(func)(*args, **kwargs)

    return wrapper  # type: ignore


class SegmentAPI(ServerAPI):
    """API implementation utilizing the new segment-based internal architecture"""

    _settings: Settings
    _sysdb: SysDB
    _manager: SegmentManager
    _executor: Executor
    _producer: Producer
    _product_telemetry_client: ProductTelemetryClient
    _opentelemetry_client: OpenTelemetryClient
    _tenant_id: str
    _topic_ns: str
    _rate_limit_enforcer: RateLimitEnforcer

    def __init__(self, system: System):
        super().__init__(system)
        self._settings = system.settings
        self._sysdb = self.require(SysDB)
        self._manager = self.require(SegmentManager)
        self._executor = self.require(Executor)
        self._quota_enforcer = self.require(QuotaEnforcer)
        self._product_telemetry_client = self.require(ProductTelemetryClient)
        self._opentelemetry_client = self.require(OpenTelemetryClient)
        self._producer = self.require(Producer)
        self._rate_limit_enforcer = self._system.require(RateLimitEnforcer)

    @override
    def heartbeat(self) -> int:
        return int(time.time_ns())

    @trace_method("SegmentAPI.create_database", OpenTelemetryGranularity.OPERATION)
    @override
    def create_database(self, name: str, tenant: str = DEFAULT_TENANT) -> None:
        if len(name) < 3:
            raise ValueError("Database name must be at least 3 characters long")

        self._quota_enforcer.enforce(
            action=Action.CREATE_DATABASE,
            tenant=tenant,
            name=name,
        )

        self._sysdb.create_database(
            id=uuid4(),
            name=name,
            tenant=tenant,
        )

    @trace_method("SegmentAPI.get_database", OpenTelemetryGranularity.OPERATION)
    @override
    def get_database(self, name: str, tenant: str = DEFAULT_TENANT) -> t.Database:
        return self._sysdb.get_database(name=name, tenant=tenant)

    @trace_method("SegmentAPI.delete_database", OpenTelemetryGranularity.OPERATION)
    @override
    def delete_database(self, name: str, tenant: str = DEFAULT_TENANT) -> None:
        self._sysdb.delete_database(name=name, tenant=tenant)

    @trace_method("SegmentAPI.list_databases", OpenTelemetryGranularity.OPERATION)
    @override
    def list_databases(
        self,
        limit: Optional[int] = None,
        offset: Optional[int] = None,
        tenant: str = DEFAULT_TENANT,
    ) -> Sequence[t.Database]:
        return self._sysdb.list_databases(limit=limit, offset=offset, tenant=tenant)

    @trace_method("SegmentAPI.create_tenant", OpenTelemetryGranularity.OPERATION)
    @override
    def create_tenant(self, name: str) -> None:
        if len(name) < 3:
            raise ValueError("Tenant name must be at least 3 characters long")

        self._sysdb.create_tenant(
            name=name,
        )

    @override
    def get_user_identity(self) -> UserIdentity:
        return UserIdentity(
            user_id="",
            tenant=DEFAULT_TENANT,
            databases=[DEFAULT_DATABASE],
        )

    @trace_method("SegmentAPI.get_tenant", OpenTelemetryGranularity.OPERATION)
    @override
    def get_tenant(self, name: str) -> t.Tenant:
        return self._sysdb.get_tenant(name=name)

    # TODO: Actually fix CollectionMetadata type to remove type: ignore flags. This is
    # necessary because changing the value type from `Any` to`` `Union[str, int, float]`
    # causes the system to somehow convert all values to strings.
    @trace_method("SegmentAPI.create_collection", OpenTelemetryGranularity.OPERATION)
    @override
    @rate_limit
    def create_collection(
        self,
        name: str,
        configuration: Optional[CreateCollectionConfiguration] = None,
        metadata: Optional[CollectionMetadata] = None,
        get_or_create: bool = False,
        tenant: str = DEFAULT_TENANT,
        database: str = DEFAULT_DATABASE,
    ) -> CollectionModel:
        if metadata is not None:
            validate_metadata(metadata)

        # TODO: remove backwards compatibility in naming requirements
        check_index_name(name)

        self._quota_enforcer.enforce(
            action=Action.CREATE_COLLECTION,
            tenant=tenant,
            name=name,
            metadata=metadata,
        )

        id = uuid4()

        model = CollectionModel(
            id=id,
            name=name,
            metadata=metadata,
            configuration_json=create_collection_configuration_to_json(
                configuration or CreateCollectionConfiguration()
            ),
            tenant=tenant,
            database=database,
            dimension=None,
        )

        # TODO: Let sysdb create the collection directly from the model
        coll, created = self._sysdb.create_collection(
            id=model.id,
            name=model.name,
            configuration=configuration or CreateCollectionConfiguration(),
            segments=[],  # Passing empty till backend changes are deployed.
            metadata=model.metadata,
            dimension=None,  # This is lazily populated on the first add
            get_or_create=get_or_create,
            tenant=tenant,
            database=database,
        )

        if created:
            segments = self._manager.prepare_segments_for_new_collection(coll)
            for segment in segments:
                self._sysdb.create_segment(segment)
        else:
            logger.debug(
                f"Collection {name} already exists, returning existing collection."
            )

        # TODO: This event doesn't capture the get_or_create case appropriately
        # TODO: Re-enable embedding function tracking in create_collection
        self._product_telemetry_client.capture(
            ClientCreateCollectionEvent(
                collection_uuid=str(id),
                # embedding_function=embedding_function.__class__.__name__,
            )
        )
        add_attributes_to_current_span({"collection_uuid": str(id)})

        return coll

    @trace_method(
        "SegmentAPI.get_or_create_collection", OpenTelemetryGranularity.OPERATION
    )
    @override
    @rate_limit
    def get_or_create_collection(
        self,
        name: str,
        configuration: Optional[CreateCollectionConfiguration] = None,
        metadata: Optional[CollectionMetadata] = None,
        tenant: str = DEFAULT_TENANT,
        database: str = DEFAULT_DATABASE,
    ) -> CollectionModel:
        return self.create_collection(
            name=name,
            metadata=metadata,
            configuration=configuration,
            get_or_create=True,
            tenant=tenant,
            database=database,
        )

    # TODO: Actually fix CollectionMetadata type to remove type: ignore flags. This is
    # necessary because changing the value type from `Any` to`` `Union[str, int, float]`
    # causes the system to somehow convert all values to strings
    @trace_method("SegmentAPI.get_collection", OpenTelemetryGranularity.OPERATION)
    @override
    @rate_limit
    def get_collection(
        self,
        name: Optional[str] = None,
        tenant: str = DEFAULT_TENANT,
        database: str = DEFAULT_DATABASE,
    ) -> CollectionModel:
        existing = self._sysdb.get_collections(
            name=name, tenant=tenant, database=database
        )

        if existing:
            return existing[0]
        else:
            raise NotFoundError(f"Collection {name} does not exist.")

    @trace_method("SegmentAPI.list_collection", OpenTelemetryGranularity.OPERATION)
    @override
    @rate_limit
    def list_collections(
        self,
        limit: Optional[int] = None,
        offset: Optional[int] = None,
        tenant: str = DEFAULT_TENANT,
        database: str = DEFAULT_DATABASE,
    ) -> Sequence[CollectionModel]:
        self._quota_enforcer.enforce(
            action=Action.LIST_COLLECTIONS,
            tenant=tenant,
            limit=limit,
        )

        return self._sysdb.get_collections(
            limit=limit, offset=offset, tenant=tenant, database=database
        )

    @trace_method("SegmentAPI.count_collections", OpenTelemetryGranularity.OPERATION)
    @override
    @rate_limit
    def count_collections(
        self,
        tenant: str = DEFAULT_TENANT,
        database: str = DEFAULT_DATABASE,
    ) -> int:
        return self._sysdb.count_collections(tenant=tenant, database=database)

    @trace_method("SegmentAPI._modify", OpenTelemetryGranularity.OPERATION)
    @override
    @rate_limit
    def _modify(
        self,
        id: UUID,
        new_name: Optional[str] = None,
        new_metadata: Optional[CollectionMetadata] = None,
        new_configuration: Optional[UpdateCollectionConfiguration] = None,
        tenant: str = DEFAULT_TENANT,
        database: str = DEFAULT_DATABASE,
    ) -> None:
        if new_name:
            # backwards compatibility in naming requirements (for now)
            check_index_name(new_name)

        if new_metadata:
            validate_update_metadata(new_metadata)

        # Ensure the collection exists
        _ = self._get_collection(id)

        self._quota_enforcer.enforce(
            action=Action.UPDATE_COLLECTION,
            tenant=tenant,
            name=new_name,
            metadata=new_metadata,
        )

        # TODO eventually we'll want to use OptionalArgument and Unspecified in the
        # signature of `_modify` but not changing the API right now.
        if new_name and new_metadata and new_configuration:
            self._sysdb.update_collection(
                id,
                name=new_name,
                metadata=new_metadata,
                configuration=new_configuration,
            )
        elif new_name and new_metadata:
            self._sysdb.update_collection(id, name=new_name, metadata=new_metadata)
        elif new_name and new_configuration:
            self._sysdb.update_collection(
                id, name=new_name, configuration=new_configuration
            )
        elif new_metadata and new_configuration:
            self._sysdb.update_collection(
                id, metadata=new_metadata, configuration=new_configuration
            )
        elif new_name:
            self._sysdb.update_collection(id, name=new_name)
        elif new_metadata:
            self._sysdb.update_collection(id, metadata=new_metadata)
        elif new_configuration:
            self._sysdb.update_collection(id, configuration=new_configuration)

    @override
    def _fork(
        self,
        collection_id: UUID,
        new_name: str,
        tenant: str = DEFAULT_TENANT,
        database: str = DEFAULT_DATABASE,
    ) -> CollectionModel:
        raise NotImplementedError(
            "Collection forking is not implemented for SegmentAPI"
        )

    @trace_method("SegmentAPI.delete_collection", OpenTelemetryGranularity.OPERATION)
    @override
    @rate_limit
    def delete_collection(
        self,
        name: str,
        tenant: str = DEFAULT_TENANT,
        database: str = DEFAULT_DATABASE,
    ) -> None:
        existing = self._sysdb.get_collections(
            name=name, tenant=tenant, database=database
        )

        if existing:
            self._manager.delete_segments(existing[0].id)
            self._sysdb.delete_collection(
                existing[0].id, tenant=tenant, database=database
            )
        else:
            raise ValueError(f"Collection {name} does not exist.")

    @trace_method("SegmentAPI._add", OpenTelemetryGranularity.OPERATION)
    @override
    @rate_limit
    def _add(
        self,
        ids: IDs,
        collection_id: UUID,
        embeddings: Embeddings,
        metadatas: Optional[Metadatas] = None,
        documents: Optional[Documents] = None,
        uris: Optional[URIs] = None,
        tenant: str = DEFAULT_TENANT,
        database: str = DEFAULT_DATABASE,
    ) -> bool:
        coll = self._get_collection(collection_id)
        self._manager.hint_use_collection(collection_id, t.Operation.ADD)
        validate_batch(
            (ids, embeddings, metadatas, documents, uris),
            {"max_batch_size": self.get_max_batch_size()},
        )
        records_to_submit = list(
            _records(
                t.Operation.ADD,
                ids=ids,
                embeddings=embeddings,
                metadatas=metadatas,
                documents=documents,
                uris=uris,
            )
        )
        self._validate_embedding_record_set(coll, records_to_submit)

        self._quota_enforcer.enforce(
            action=Action.ADD,
            tenant=tenant,
            ids=ids,
            embeddings=embeddings,
            metadatas=metadatas,
            documents=documents,
            uris=uris,
            collection_id=collection_id,
        )

        self._producer.submit_embeddings(collection_id, records_to_submit)

        self._product_telemetry_client.capture(
            CollectionAddEvent(
                collection_uuid=str(collection_id),
                add_amount=len(ids),
                with_metadata=len(ids) if metadatas is not None else 0,
                with_documents=len(ids) if documents is not None else 0,
                with_uris=len(ids) if uris is not None else 0,
            )
        )
        return True

    @trace_method("SegmentAPI._update", OpenTelemetryGranularity.OPERATION)
    @override
    @rate_limit
    def _update(
        self,
        collection_id: UUID,
        ids: IDs,
        embeddings: Optional[Embeddings] = None,
        metadatas: Optional[Metadatas] = None,
        documents: Optional[Documents] = None,
        uris: Optional[URIs] = None,
        tenant: str = DEFAULT_TENANT,
        database: str = DEFAULT_DATABASE,
    ) -> bool:
        coll = self._get_collection(collection_id)
        self._manager.hint_use_collection(collection_id, t.Operation.UPDATE)
        validate_batch(
            (ids, embeddings, metadatas, documents, uris),
            {"max_batch_size": self.get_max_batch_size()},
        )
        records_to_submit = list(
            _records(
                t.Operation.UPDATE,
                ids=ids,
                embeddings=embeddings,
                metadatas=metadatas,
                documents=documents,
                uris=uris,
            )
        )
        self._validate_embedding_record_set(coll, records_to_submit)

        self._quota_enforcer.enforce(
            action=Action.UPDATE,
            tenant=tenant,
            ids=ids,
            embeddings=embeddings,
            metadatas=metadatas,
            documents=documents,
            uris=uris,
        )

        self._producer.submit_embeddings(collection_id, records_to_submit)

        self._product_telemetry_client.capture(
            CollectionUpdateEvent(
                collection_uuid=str(collection_id),
                update_amount=len(ids),
                with_embeddings=len(embeddings) if embeddings else 0,
                with_metadata=len(metadatas) if metadatas else 0,
                with_documents=len(documents) if documents else 0,
                with_uris=len(uris) if uris else 0,
            )
        )

        return True

    @trace_method("SegmentAPI._upsert", OpenTelemetryGranularity.OPERATION)
    @override
    @rate_limit
    def _upsert(
        self,
        collection_id: UUID,
        ids: IDs,
        embeddings: Embeddings,
        metadatas: Optional[Metadatas] = None,
        documents: Optional[Documents] = None,
        uris: Optional[URIs] = None,
        tenant: str = DEFAULT_TENANT,
        database: str = DEFAULT_DATABASE,
    ) -> bool:
        coll = self._get_collection(collection_id)
        self._manager.hint_use_collection(collection_id, t.Operation.UPSERT)
        validate_batch(
            (ids, embeddings, metadatas, documents, uris),
            {"max_batch_size": self.get_max_batch_size()},
        )
        records_to_submit = list(
            _records(
                t.Operation.UPSERT,
                ids=ids,
                embeddings=embeddings,
                metadatas=metadatas,
                documents=documents,
                uris=uris,
            )
        )
        self._validate_embedding_record_set(coll, records_to_submit)

        self._quota_enforcer.enforce(
            action=Action.UPSERT,
            tenant=tenant,
            ids=ids,
            embeddings=embeddings,
            metadatas=metadatas,
            documents=documents,
            uris=uris,
            collection_id=collection_id,
        )

        self._producer.submit_embeddings(collection_id, records_to_submit)

        return True

    @trace_method("SegmentAPI._get", OpenTelemetryGranularity.OPERATION)
    @retry(  # type: ignore[misc]
        retry=retry_if_exception(lambda e: isinstance(e, VersionMismatchError)),
        wait=wait_fixed(2),
        stop=stop_after_attempt(5),
        reraise=True,
    )
    @override
    @rate_limit
    def _get(
        self,
        collection_id: UUID,
        ids: Optional[IDs] = None,
        where: Optional[Where] = None,
        limit: Optional[int] = None,
        offset: Optional[int] = None,
        where_document: Optional[WhereDocument] = None,
        include: Include = IncludeMetadataDocuments,
        tenant: str = DEFAULT_TENANT,
        database: str = DEFAULT_DATABASE,
    ) -> GetResult:
        add_attributes_to_current_span(
            {
                "collection_id": str(collection_id),
                "ids_count": len(ids) if ids else 0,
            }
        )

        scan = self._scan(collection_id)

        # TODO: Replace with unified validation
        if where is not None:
            validate_where(where)

        if where_document is not None:
            validate_where_document(where_document)

        self._quota_enforcer.enforce(
            action=Action.GET,
            tenant=tenant,
            ids=ids,
            where=where,
            where_document=where_document,
            limit=limit,
        )

        ids_amount = len(ids) if ids else 0
        self._product_telemetry_client.capture(
            CollectionGetEvent(
                collection_uuid=str(collection_id),
                ids_count=ids_amount,
                limit=limit if limit else 0,
                include_metadata=ids_amount if "metadatas" in include else 0,
                include_documents=ids_amount if "documents" in include else 0,
                include_uris=ids_amount if "uris" in include else 0,
            )
        )

        return self._executor.get(
            GetPlan(
                scan,
                Filter(ids, where, where_document),
                Limit(offset or 0, limit),
                Projection(
                    "documents" in include,
                    "embeddings" in include,
                    "metadatas" in include,
                    False,
                    "uris" in include,
                ),
            )
        )

    @trace_method("SegmentAPI._delete", OpenTelemetryGranularity.OPERATION)
    @override
    @rate_limit
    def _delete(
        self,
        collection_id: UUID,
        ids: Optional[IDs] = None,
        where: Optional[Where] = None,
        where_document: Optional[WhereDocument] = None,
        tenant: str = DEFAULT_TENANT,
        database: str = DEFAULT_DATABASE,
    ) -> None:
        add_attributes_to_current_span(
            {
                "collection_id": str(collection_id),
                "ids_count": len(ids) if ids else 0,
            }
        )

        # TODO: Replace with unified validation
        if where is not None:
            validate_where(where)

        if where_document is not None:
            validate_where_document(where_document)

        # You must have at least one of non-empty ids, where, or where_document.
        if (
            (ids is None or (ids is not None and len(ids) == 0))
            and (where is None or (where is not None and len(where) == 0))
            and (
                where_document is None
                or (where_document is not None and len(where_document) == 0)
            )
        ):
            raise ValueError(
                """
                You must provide either ids, where, or where_document to delete. If
                you want to delete all data in a collection you can delete the
                collection itself using the delete_collection method. Or alternatively,
                you can get() all the relevant ids and then delete them.
                """
            )

        scan = self._scan(collection_id)

        self._quota_enforcer.enforce(
            action=Action.DELETE,
            tenant=tenant,
            ids=ids,
            where=where,
            where_document=where_document,
        )

        self._manager.hint_use_collection(collection_id, t.Operation.DELETE)

        if (where or where_document) or not ids:
            ids_to_delete = self._executor.get(
                GetPlan(scan, Filter(ids, where, where_document))
            )["ids"]
        else:
            ids_to_delete = ids

        if len(ids_to_delete) == 0:
            return

        records_to_submit = list(
            _records(operation=t.Operation.DELETE, ids=ids_to_delete)
        )
        self._validate_embedding_record_set(scan.collection, records_to_submit)
        self._producer.submit_embeddings(collection_id, records_to_submit)

        self._product_telemetry_client.capture(
            CollectionDeleteEvent(
                collection_uuid=str(collection_id), delete_amount=len(ids_to_delete)
            )
        )

    @trace_method("SegmentAPI._count", OpenTelemetryGranularity.OPERATION)
    @retry(  # type: ignore[misc]
        retry=retry_if_exception(lambda e: isinstance(e, VersionMismatchError)),
        wait=wait_fixed(2),
        stop=stop_after_attempt(5),
        reraise=True,
    )
    @override
    @rate_limit
    def _count(
        self,
        collection_id: UUID,
        tenant: str = DEFAULT_TENANT,
        database: str = DEFAULT_DATABASE,
    ) -> int:
        add_attributes_to_current_span({"collection_id": str(collection_id)})
        return self._executor.count(CountPlan(self._scan(collection_id)))

    @trace_method("SegmentAPI._query", OpenTelemetryGranularity.OPERATION)
    # We retry on version mismatch errors because the version of the collection
    # may have changed between the time we got the version and the time we
    # actually query the collection on the FE. We are fine with fixed
    # wait time because the version mismatch error is not a error due to
    # network issues or other transient issues. It is a result of the
    # collection being updated between the time we got the version and
    # the time we actually query the collection on the FE.
    @retry(  # type: ignore[misc]
        retry=retry_if_exception(lambda e: isinstance(e, VersionMismatchError)),
        wait=wait_fixed(2),
        stop=stop_after_attempt(5),
        reraise=True,
    )
    @override
    @rate_limit
    def _query(
        self,
        collection_id: UUID,
        query_embeddings: Embeddings,
        ids: Optional[IDs] = None,
        n_results: int = 10,
        where: Optional[Where] = None,
        where_document: Optional[WhereDocument] = None,
        include: Include = IncludeMetadataDocumentsDistances,
        tenant: str = DEFAULT_TENANT,
        database: str = DEFAULT_DATABASE,
    ) -> QueryResult:
        add_attributes_to_current_span(
            {
                "collection_id": str(collection_id),
                "n_results": n_results,
                "where": str(where),
            }
        )

        query_amount = len(query_embeddings)
        ids_amount = len(ids) if ids else 0
        self._product_telemetry_client.capture(
            CollectionQueryEvent(
                collection_uuid=str(collection_id),
                query_amount=query_amount,
                filtered_ids_amount=ids_amount,
                n_results=n_results,
                with_metadata_filter=query_amount if where is not None else 0,
                with_document_filter=query_amount if where_document is not None else 0,
                include_metadatas=query_amount if "metadatas" in include else 0,
                include_documents=query_amount if "documents" in include else 0,
                include_uris=query_amount if "uris" in include else 0,
                include_distances=query_amount if "distances" in include else 0,
            )
        )

        # TODO: Replace with unified validation
        if where is not None:
            validate_where(where)
        if where_document is not None:
            validate_where_document(where_document)

        scan = self._scan(collection_id)
        for embedding in query_embeddings:
            self._validate_dimension(scan.collection, len(embedding), update=False)

        self._quota_enforcer.enforce(
            action=Action.QUERY,
            tenant=tenant,
            where=where,
            where_document=where_document,
            query_embeddings=query_embeddings,
            n_results=n_results,
        )

        return self._executor.knn(
            KNNPlan(
                scan,
                KNN(query_embeddings, n_results),
                Filter(None, where, where_document),
                Projection(
                    "documents" in include,
                    "embeddings" in include,
                    "metadatas" in include,
                    "distances" in include,
                    "uris" in include,
                ),
            )
        )

    @trace_method("SegmentAPI._peek", OpenTelemetryGranularity.OPERATION)
    @override
    @rate_limit
    def _peek(
        self,
        collection_id: UUID,
        n: int = 10,
        tenant: str = DEFAULT_TENANT,
        database: str = DEFAULT_DATABASE,
    ) -> GetResult:
        add_attributes_to_current_span({"collection_id": str(collection_id)})
        return self._get(collection_id, limit=n)  # type: ignore

    @override
    def get_version(self) -> str:
        return __version__

    @override
    def reset_state(self) -> None:
        pass

    @override
    def reset(self) -> bool:
        self._system.reset_state()
        return True

    @override
    def get_settings(self) -> Settings:
        return self._settings

    @override
    def get_max_batch_size(self) -> int:
        return self._producer.max_batch_size

    # TODO: This could potentially cause race conditions in a distributed version of the
    # system, since the cache is only local.
    # TODO: promote collection -> topic to a base class method so that it can be
    # used for channel assignment in the distributed version of the system.
    @trace_method(
        "SegmentAPI._validate_embedding_record_set", OpenTelemetryGranularity.ALL
    )
    def _validate_embedding_record_set(
        self, collection: t.Collection, records: List[t.OperationRecord]
    ) -> None:
        """Validate the dimension of an embedding record before submitting it to the system."""
        add_attributes_to_current_span({"collection_id": str(collection["id"])})
        for record in records:
            if record["embedding"] is not None:
                self._validate_dimension(
                    collection, len(record["embedding"]), update=True
                )

    # This method is intentionally left untraced because otherwise it can emit thousands of spans for requests containing many embeddings.
    def _validate_dimension(
        self, collection: t.Collection, dim: int, update: bool
    ) -> None:
        """Validate that a collection supports records of the given dimension. If update
        is true, update the collection if the collection doesn't already have a
        dimension."""
        if collection["dimension"] is None:
            if update:
                id = collection.id
                self._sysdb.update_collection(id=id, dimension=dim)
                collection["dimension"] = dim
        elif collection["dimension"] != dim:
            raise InvalidDimensionException(
                f"Embedding dimension {dim} does not match collection dimensionality {collection['dimension']}"
            )
        else:
            return  # all is well

    @trace_method("SegmentAPI._get_collection", OpenTelemetryGranularity.ALL)
    def _get_collection(self, collection_id: UUID) -> t.Collection:
        collections = self._sysdb.get_collections(id=collection_id)
        if not collections or len(collections) == 0:
            raise NotFoundError(f"Collection {collection_id} does not exist.")
        return collections[0]

    @trace_method("SegmentAPI._scan", OpenTelemetryGranularity.OPERATION)
    def _scan(self, collection_id: UUID) -> Scan:
        collection_and_segments = self._sysdb.get_collection_with_segments(
            collection_id
        )
        # For now collection should have exactly one segment per scope:
        # - Local scopes: vector, metadata
        # - Distributed scopes: vector, metadata, record
        scope_to_segment = {
            segment["scope"]: segment for segment in collection_and_segments["segments"]
        }
        return Scan(
            collection=collection_and_segments["collection"],
            knn=scope_to_segment[t.SegmentScope.VECTOR],
            metadata=scope_to_segment[t.SegmentScope.METADATA],
            # Local chroma do not have record segment, and this is not used by the local executor
            record=scope_to_segment.get(t.SegmentScope.RECORD, None),  # type: ignore[arg-type]
        )


def _records(
    operation: t.Operation,
    ids: IDs,
    embeddings: Optional[Embeddings] = None,
    metadatas: Optional[Metadatas] = None,
    documents: Optional[Documents] = None,
    uris: Optional[URIs] = None,
) -> Generator[t.OperationRecord, None, None]:
    """Convert parallel lists of embeddings, metadatas and documents to a sequence of
    SubmitEmbeddingRecords"""

    # Presumes that callers were invoked via  Collection model, which means
    # that we know that the embeddings, metadatas and documents have already been
    # normalized and are guaranteed to be consistently named lists.

    if embeddings == []:
        embeddings = None

    for i, id in enumerate(ids):
        metadata = None
        if metadatas:
            metadata = metadatas[i]

        if documents:
            document = documents[i]
            if metadata:
                metadata = {**metadata, "chroma:document": document}
            else:
                metadata = {"chroma:document": document}

        if uris:
            uri = uris[i]
            if metadata:
                metadata = {**metadata, "chroma:uri": uri}
            else:
                metadata = {"chroma:uri": uri}

        record = t.OperationRecord(
            id=id,
            embedding=embeddings[i] if embeddings is not None else None,
            encoding=t.ScalarEncoding.FLOAT32,  # Hardcode for now
            metadata=metadata,
            operation=operation,
        )
        yield record
