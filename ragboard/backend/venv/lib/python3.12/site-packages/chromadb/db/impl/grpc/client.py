from typing import List, Optional, Sequence, Tuple, Union, cast
from uuid import UUID
from overrides import overrides
from chromadb.api.collection_configuration import (
    CreateCollectionConfiguration,
    create_collection_configuration_to_json_str,
    UpdateCollectionConfiguration,
    update_collection_configuration_to_json_str,
)
from chromadb.config import DEFAULT_DATABASE, DEFAULT_TENANT, System, logger
from chromadb.db.system import SysDB
from chromadb.errors import NotFoundError, UniqueConstraintError, InternalError
from chromadb.proto.convert import (
    from_proto_collection,
    from_proto_segment,
    to_proto_update_metadata,
    to_proto_segment,
    to_proto_segment_scope,
)
from chromadb.proto.coordinator_pb2 import (
    CreateCollectionRequest,
    CreateDatabaseRequest,
    CreateSegmentRequest,
    CreateTenantRequest,
    CountCollectionsRequest,
    CountCollectionsResponse,
    DeleteCollectionRequest,
    DeleteDatabaseRequest,
    DeleteSegmentRequest,
    GetCollectionsRequest,
    GetCollectionsResponse,
    GetCollectionSizeRequest,
    GetCollectionSizeResponse,
    GetCollectionWithSegmentsRequest,
    GetCollectionWithSegmentsResponse,
    GetDatabaseRequest,
    GetSegmentsRequest,
    GetTenantRequest,
    ListDatabasesRequest,
    UpdateCollectionRequest,
    UpdateSegmentRequest,
)
from chromadb.proto.coordinator_pb2_grpc import SysDBStub
from chromadb.proto.utils import RetryOnRpcErrorClientInterceptor
from chromadb.telemetry.opentelemetry.grpc import OtelInterceptor
from chromadb.telemetry.opentelemetry import (
    OpenTelemetryGranularity,
    trace_method,
)
from chromadb.types import (
    Collection,
    CollectionAndSegments,
    Database,
    Metadata,
    OptionalArgument,
    Segment,
    SegmentScope,
    Tenant,
    Unspecified,
    UpdateMetadata,
)
from google.protobuf.empty_pb2 import Empty
import grpc


class GrpcSysDB(SysDB):
    """A gRPC implementation of the SysDB. In the distributed system, the SysDB is also
    called the 'Coordinator'. This implementation is used by Chroma frontend servers
    to call a remote SysDB (Coordinator) service."""

    _sys_db_stub: SysDBStub
    _channel: grpc.Channel
    _coordinator_url: str
    _coordinator_port: int
    _request_timeout_seconds: int

    def __init__(self, system: System):
        self._coordinator_url = system.settings.require("chroma_coordinator_host")
        # TODO: break out coordinator_port into a separate setting?
        self._coordinator_port = system.settings.require("chroma_server_grpc_port")
        self._request_timeout_seconds = system.settings.require(
            "chroma_sysdb_request_timeout_seconds"
        )
        return super().__init__(system)

    @overrides
    def start(self) -> None:
        self._channel = grpc.insecure_channel(
            f"{self._coordinator_url}:{self._coordinator_port}",
            options=[("grpc.max_concurrent_streams", 1000)],
        )
        interceptors = [OtelInterceptor(), RetryOnRpcErrorClientInterceptor()]
        self._channel = grpc.intercept_channel(self._channel, *interceptors)
        self._sys_db_stub = SysDBStub(self._channel)  # type: ignore
        return super().start()

    @overrides
    def stop(self) -> None:
        self._channel.close()
        return super().stop()

    @overrides
    def reset_state(self) -> None:
        self._sys_db_stub.ResetState(Empty())
        return super().reset_state()

    @overrides
    def create_database(
        self, id: UUID, name: str, tenant: str = DEFAULT_TENANT
    ) -> None:
        try:
            request = CreateDatabaseRequest(id=id.hex, name=name, tenant=tenant)
            response = self._sys_db_stub.CreateDatabase(
                request, timeout=self._request_timeout_seconds
            )
        except grpc.RpcError as e:
            logger.info(
                f"Failed to create database name {name} and database id {id} for tenant {tenant} due to error: {e}"
            )
            if e.code() == grpc.StatusCode.ALREADY_EXISTS:
                raise UniqueConstraintError()
            raise InternalError()

    @overrides
    def get_database(self, name: str, tenant: str = DEFAULT_TENANT) -> Database:
        try:
            request = GetDatabaseRequest(name=name, tenant=tenant)
            response = self._sys_db_stub.GetDatabase(
                request, timeout=self._request_timeout_seconds
            )
            return Database(
                id=UUID(hex=response.database.id),
                name=response.database.name,
                tenant=response.database.tenant,
            )
        except grpc.RpcError as e:
            logger.info(
                f"Failed to get database {name} for tenant {tenant} due to error: {e}"
            )
            if e.code() == grpc.StatusCode.NOT_FOUND:
                raise NotFoundError()
            raise InternalError()

    @overrides
    def delete_database(self, name: str, tenant: str = DEFAULT_TENANT) -> None:
        try:
            request = DeleteDatabaseRequest(name=name, tenant=tenant)
            self._sys_db_stub.DeleteDatabase(
                request, timeout=self._request_timeout_seconds
            )
        except grpc.RpcError as e:
            logger.info(
                f"Failed to delete database {name} for tenant {tenant} due to error: {e}"
            )
            if e.code() == grpc.StatusCode.NOT_FOUND:
                raise NotFoundError()
            raise InternalError

    @overrides
    def list_databases(
        self,
        limit: Optional[int] = None,
        offset: Optional[int] = None,
        tenant: str = DEFAULT_TENANT,
    ) -> Sequence[Database]:
        try:
            request = ListDatabasesRequest(limit=limit, offset=offset, tenant=tenant)
            response = self._sys_db_stub.ListDatabases(
                request, timeout=self._request_timeout_seconds
            )
            results: List[Database] = []
            for proto_database in response.databases:
                results.append(
                    Database(
                        id=UUID(hex=proto_database.id),
                        name=proto_database.name,
                        tenant=proto_database.tenant,
                    )
                )
            return results
        except grpc.RpcError as e:
            logger.info(
                f"Failed to list databases for tenant {tenant} due to error: {e}"
            )
            raise InternalError()

    @overrides
    def create_tenant(self, name: str) -> None:
        try:
            request = CreateTenantRequest(name=name)
            response = self._sys_db_stub.CreateTenant(
                request, timeout=self._request_timeout_seconds
            )
        except grpc.RpcError as e:
            logger.info(f"Failed to create tenant {name} due to error: {e}")
            if e.code() == grpc.StatusCode.ALREADY_EXISTS:
                raise UniqueConstraintError()
            raise InternalError()

    @overrides
    def get_tenant(self, name: str) -> Tenant:
        try:
            request = GetTenantRequest(name=name)
            response = self._sys_db_stub.GetTenant(
                request, timeout=self._request_timeout_seconds
            )
            return Tenant(
                name=response.tenant.name,
            )
        except grpc.RpcError as e:
            logger.info(f"Failed to get tenant {name} due to error: {e}")
            if e.code() == grpc.StatusCode.NOT_FOUND:
                raise NotFoundError()
            raise InternalError()

    @overrides
    def create_segment(self, segment: Segment) -> None:
        try:
            proto_segment = to_proto_segment(segment)
            request = CreateSegmentRequest(
                segment=proto_segment,
            )
            response = self._sys_db_stub.CreateSegment(
                request, timeout=self._request_timeout_seconds
            )
        except grpc.RpcError as e:
            logger.info(f"Failed to create segment {segment}, error: {e}")
            if e.code() == grpc.StatusCode.ALREADY_EXISTS:
                raise UniqueConstraintError()
            raise InternalError()

    @overrides
    def delete_segment(self, collection: UUID, id: UUID) -> None:
        try:
            request = DeleteSegmentRequest(
                id=id.hex,
                collection=collection.hex,
            )
            response = self._sys_db_stub.DeleteSegment(
                request, timeout=self._request_timeout_seconds
            )
        except grpc.RpcError as e:
            logger.info(
                f"Failed to delete segment with id {id} for collection {collection} due to error: {e}"
            )
            if e.code() == grpc.StatusCode.NOT_FOUND:
                raise NotFoundError()
            raise InternalError()

    @overrides
    def get_segments(
        self,
        collection: UUID,
        id: Optional[UUID] = None,
        type: Optional[str] = None,
        scope: Optional[SegmentScope] = None,
    ) -> Sequence[Segment]:
        try:
            request = GetSegmentsRequest(
                id=id.hex if id else None,
                type=type,
                scope=to_proto_segment_scope(scope) if scope else None,
                collection=collection.hex,
            )
            response = self._sys_db_stub.GetSegments(
                request, timeout=self._request_timeout_seconds
            )
            results: List[Segment] = []
            for proto_segment in response.segments:
                segment = from_proto_segment(proto_segment)
                results.append(segment)
            return results
        except grpc.RpcError as e:
            logger.info(
                f"Failed to get segment id {id}, type {type}, scope {scope} for collection {collection} due to error: {e}"
            )
            raise InternalError()

    @overrides
    def update_segment(
        self,
        collection: UUID,
        id: UUID,
        metadata: OptionalArgument[Optional[UpdateMetadata]] = Unspecified(),
    ) -> None:
        try:
            write_metadata = None
            if metadata != Unspecified():
                write_metadata = cast(Union[UpdateMetadata, None], metadata)

            request = UpdateSegmentRequest(
                id=id.hex,
                collection=collection.hex,
                metadata=to_proto_update_metadata(write_metadata)
                if write_metadata
                else None,
            )

            if metadata is None:
                request.ClearField("metadata")
                request.reset_metadata = True

            self._sys_db_stub.UpdateSegment(
                request, timeout=self._request_timeout_seconds
            )
        except grpc.RpcError as e:
            logger.info(
                f"Failed to update segment with id {id} for collection {collection}, error: {e}"
            )
            raise InternalError()

    @overrides
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
        try:
            request = CreateCollectionRequest(
                id=id.hex,
                name=name,
                configuration_json_str=create_collection_configuration_to_json_str(
                    configuration
                ),
                metadata=to_proto_update_metadata(metadata) if metadata else None,
                dimension=dimension,
                get_or_create=get_or_create,
                tenant=tenant,
                database=database,
                segments=[to_proto_segment(segment) for segment in segments],
            )
            response = self._sys_db_stub.CreateCollection(
                request, timeout=self._request_timeout_seconds
            )
            collection = from_proto_collection(response.collection)
            return collection, response.created
        except grpc.RpcError as e:
            logger.error(
                f"Failed to create collection id {id}, name {name} for database {database} and tenant {tenant} due to error: {e}"
            )
            if e.code() == grpc.StatusCode.ALREADY_EXISTS:
                raise UniqueConstraintError()
            raise InternalError()

    @overrides
    def delete_collection(
        self,
        id: UUID,
        tenant: str = DEFAULT_TENANT,
        database: str = DEFAULT_DATABASE,
    ) -> None:
        try:
            request = DeleteCollectionRequest(
                id=id.hex,
                tenant=tenant,
                database=database,
            )
            response = self._sys_db_stub.DeleteCollection(
                request, timeout=self._request_timeout_seconds
            )
        except grpc.RpcError as e:
            logger.error(
                f"Failed to delete collection id {id} for database {database} and tenant {tenant} due to error: {e}"
            )
            e = cast(grpc.Call, e)
            logger.error(
                f"Error code: {e.code()}, NotFoundError: {grpc.StatusCode.NOT_FOUND}"
            )
            if e.code() == grpc.StatusCode.NOT_FOUND:
                raise NotFoundError()
            raise InternalError()

    @overrides
    def get_collections(
        self,
        id: Optional[UUID] = None,
        name: Optional[str] = None,
        tenant: str = DEFAULT_TENANT,
        database: str = DEFAULT_DATABASE,
        limit: Optional[int] = None,
        offset: Optional[int] = None,
    ) -> Sequence[Collection]:
        try:
            # TODO: implement limit and offset in the gRPC service
            request = None
            if id is not None:
                request = GetCollectionsRequest(
                    id=id.hex,
                    limit=limit,
                    offset=offset,
                )
            if name is not None:
                if tenant is None and database is None:
                    raise ValueError(
                        "If name is specified, tenant and database must also be specified in order to uniquely identify the collection"
                    )
                request = GetCollectionsRequest(
                    name=name,
                    tenant=tenant,
                    database=database,
                    limit=limit,
                    offset=offset,
                )
            if id is None and name is None:
                request = GetCollectionsRequest(
                    tenant=tenant,
                    database=database,
                    limit=limit,
                    offset=offset,
                )
            response: GetCollectionsResponse = self._sys_db_stub.GetCollections(
                request, timeout=self._request_timeout_seconds
            )
            results: List[Collection] = []
            for collection in response.collections:
                results.append(from_proto_collection(collection))
            return results
        except grpc.RpcError as e:
            logger.error(
                f"Failed to get collections with id {id}, name {name}, tenant {tenant}, database {database} due to error: {e}"
            )
            raise InternalError()

    @overrides
    def count_collections(
        self,
        tenant: str = DEFAULT_TENANT,
        database: Optional[str] = None,
    ) -> int:
        try:
            if database is None or database == "":
                request = CountCollectionsRequest(tenant=tenant)
                response: CountCollectionsResponse = self._sys_db_stub.CountCollections(
                    request
                )
                return response.count
            else:
                request = CountCollectionsRequest(
                    tenant=tenant,
                    database=database,
                )
                response: CountCollectionsResponse = self._sys_db_stub.CountCollections(
                    request
                )
                return response.count
        except grpc.RpcError as e:
            logger.error(f"Failed to count collections due to error: {e}")
            raise InternalError()

    @overrides
    def get_collection_size(self, id: UUID) -> int:
        try:
            request = GetCollectionSizeRequest(id=id.hex)
            response: GetCollectionSizeResponse = self._sys_db_stub.GetCollectionSize(
                request
            )
            return response.total_records_post_compaction
        except grpc.RpcError as e:
            logger.error(f"Failed to get collection {id} size due to error: {e}")
            raise InternalError()

    @trace_method(
        "SysDB.get_collection_with_segments", OpenTelemetryGranularity.OPERATION
    )
    @overrides
    def get_collection_with_segments(
        self, collection_id: UUID
    ) -> CollectionAndSegments:
        try:
            request = GetCollectionWithSegmentsRequest(id=collection_id.hex)
            response: GetCollectionWithSegmentsResponse = (
                self._sys_db_stub.GetCollectionWithSegments(request)
            )
            return CollectionAndSegments(
                collection=from_proto_collection(response.collection),
                segments=[from_proto_segment(segment) for segment in response.segments],
            )
        except grpc.RpcError as e:
            if e.code() == grpc.StatusCode.NOT_FOUND:
                raise NotFoundError()
            logger.error(
                f"Failed to get collection {collection_id} and its segments due to error: {e}"
            )
            raise InternalError()

    @overrides
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
        try:
            write_name = None
            if name != Unspecified():
                write_name = cast(str, name)

            write_dimension = None
            if dimension != Unspecified():
                write_dimension = cast(Union[int, None], dimension)

            write_metadata = None
            if metadata != Unspecified():
                write_metadata = cast(Union[UpdateMetadata, None], metadata)

            write_configuration = None
            if configuration != Unspecified():
                write_configuration = cast(
                    Union[UpdateCollectionConfiguration, None], configuration
                )

            request = UpdateCollectionRequest(
                id=id.hex,
                name=write_name,
                dimension=write_dimension,
                metadata=to_proto_update_metadata(write_metadata)
                if write_metadata
                else None,
                configuration_json_str=update_collection_configuration_to_json_str(
                    write_configuration
                )
                if write_configuration
                else None,
            )
            if metadata is None:
                request.ClearField("metadata")
                request.reset_metadata = True

            response = self._sys_db_stub.UpdateCollection(
                request, timeout=self._request_timeout_seconds
            )
        except grpc.RpcError as e:
            e = cast(grpc.Call, e)
            logger.error(
                f"Failed to update collection id {id}, name {name} due to error: {e}"
            )
            if e.code() == grpc.StatusCode.NOT_FOUND:
                raise NotFoundError()
            if e.code() == grpc.StatusCode.ALREADY_EXISTS:
                raise UniqueConstraintError()
            raise InternalError()

    def reset_and_wait_for_ready(self) -> None:
        self._sys_db_stub.ResetState(Empty(), wait_for_ready=True)
