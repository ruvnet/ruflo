from concurrent import futures
from typing import Any, Dict, List, cast
from uuid import UUID
from overrides import overrides
import json

from chromadb.config import DEFAULT_DATABASE, DEFAULT_TENANT, Component, System
from chromadb.proto.convert import (
    from_proto_metadata,
    from_proto_update_metadata,
    from_proto_segment,
    from_proto_segment_scope,
    to_proto_collection,
    to_proto_segment,
)
import chromadb.proto.chroma_pb2 as proto
from chromadb.proto.coordinator_pb2 import (
    CreateCollectionRequest,
    CreateCollectionResponse,
    CreateDatabaseRequest,
    CreateDatabaseResponse,
    CreateSegmentRequest,
    CreateSegmentResponse,
    CreateTenantRequest,
    CreateTenantResponse,
    CountCollectionsRequest,
    CountCollectionsResponse,
    DeleteCollectionRequest,
    DeleteCollectionResponse,
    DeleteSegmentRequest,
    DeleteSegmentResponse,
    GetCollectionsRequest,
    GetCollectionsResponse,
    GetCollectionSizeRequest,
    GetCollectionSizeResponse,
    GetCollectionWithSegmentsRequest,
    GetCollectionWithSegmentsResponse,
    GetDatabaseRequest,
    GetDatabaseResponse,
    GetSegmentsRequest,
    GetSegmentsResponse,
    GetTenantRequest,
    GetTenantResponse,
    ResetStateResponse,
    UpdateCollectionRequest,
    UpdateCollectionResponse,
    UpdateSegmentRequest,
    UpdateSegmentResponse,
)
from chromadb.proto.coordinator_pb2_grpc import (
    SysDBServicer,
    add_SysDBServicer_to_server,
)
import grpc
from google.protobuf.empty_pb2 import Empty
from chromadb.types import Collection, Metadata, Segment, SegmentScope


class GrpcMockSysDB(SysDBServicer, Component):
    """A mock sysdb implementation that can be used for testing the grpc client. It stores
    state in simple python data structures instead of a database."""

    _server: grpc.Server
    _server_port: int
    _segments: Dict[str, Segment] = {}
    _collection_to_segments: Dict[str, List[str]] = {}
    _tenants_to_databases_to_collections: Dict[
        str, Dict[str, Dict[str, Collection]]
    ] = {}
    _tenants_to_database_to_id: Dict[str, Dict[str, UUID]] = {}

    def __init__(self, system: System):
        self._server_port = system.settings.require("chroma_server_grpc_port")
        return super().__init__(system)

    @overrides
    def start(self) -> None:
        self._server = grpc.server(futures.ThreadPoolExecutor(max_workers=10))
        add_SysDBServicer_to_server(self, self._server)  # type: ignore
        self._server.add_insecure_port(f"[::]:{self._server_port}")
        self._server.start()
        return super().start()

    @overrides
    def stop(self) -> None:
        self._server.stop(None)
        return super().stop()

    @overrides
    def reset_state(self) -> None:
        self._segments = {}
        self._tenants_to_databases_to_collections = {}
        # Create defaults
        self._tenants_to_databases_to_collections[DEFAULT_TENANT] = {}
        self._tenants_to_databases_to_collections[DEFAULT_TENANT][DEFAULT_DATABASE] = {}
        self._tenants_to_database_to_id[DEFAULT_TENANT] = {}
        self._tenants_to_database_to_id[DEFAULT_TENANT][DEFAULT_DATABASE] = UUID(int=0)
        return super().reset_state()

    @overrides(check_signature=False)
    def CreateDatabase(
        self, request: CreateDatabaseRequest, context: grpc.ServicerContext
    ) -> CreateDatabaseResponse:
        tenant = request.tenant
        database = request.name
        if tenant not in self._tenants_to_databases_to_collections:
            context.abort(grpc.StatusCode.NOT_FOUND, f"Tenant {tenant} not found")
        if database in self._tenants_to_databases_to_collections[tenant]:
            context.abort(
                grpc.StatusCode.ALREADY_EXISTS, f"Database {database} already exists"
            )
        self._tenants_to_databases_to_collections[tenant][database] = {}
        self._tenants_to_database_to_id[tenant][database] = UUID(hex=request.id)
        return CreateDatabaseResponse()

    @overrides(check_signature=False)
    def GetDatabase(
        self, request: GetDatabaseRequest, context: grpc.ServicerContext
    ) -> GetDatabaseResponse:
        tenant = request.tenant
        database = request.name
        if tenant not in self._tenants_to_databases_to_collections:
            context.abort(grpc.StatusCode.NOT_FOUND, f"Tenant {tenant} not found")
        if database not in self._tenants_to_databases_to_collections[tenant]:
            context.abort(grpc.StatusCode.NOT_FOUND, f"Database {database} not found")
        id = self._tenants_to_database_to_id[tenant][database]
        return GetDatabaseResponse(
            database=proto.Database(id=id.hex, name=database, tenant=tenant),
        )

    @overrides(check_signature=False)
    def CreateTenant(
        self, request: CreateTenantRequest, context: grpc.ServicerContext
    ) -> CreateTenantResponse:
        tenant = request.name
        if tenant in self._tenants_to_databases_to_collections:
            context.abort(
                grpc.StatusCode.ALREADY_EXISTS, f"Tenant {tenant} already exists"
            )
        self._tenants_to_databases_to_collections[tenant] = {}
        self._tenants_to_database_to_id[tenant] = {}
        return CreateTenantResponse()

    @overrides(check_signature=False)
    def GetTenant(
        self, request: GetTenantRequest, context: grpc.ServicerContext
    ) -> GetTenantResponse:
        tenant = request.name
        if tenant not in self._tenants_to_databases_to_collections:
            context.abort(grpc.StatusCode.NOT_FOUND, f"Tenant {tenant} not found")
        return GetTenantResponse(
            tenant=proto.Tenant(name=tenant),
        )

    # We are forced to use check_signature=False because the generated proto code
    # does not have type annotations for the request and response objects.
    # TODO: investigate generating types for the request and response objects
    @overrides(check_signature=False)
    def CreateSegment(
        self, request: CreateSegmentRequest, context: grpc.ServicerContext
    ) -> CreateSegmentResponse:
        segment = from_proto_segment(request.segment)
        return self.CreateSegmentHelper(segment, context)

    def CreateSegmentHelper(
        self, segment: Segment, context: grpc.ServicerContext
    ) -> CreateSegmentResponse:
        if segment["id"].hex in self._segments:
            context.abort(
                grpc.StatusCode.ALREADY_EXISTS,
                f"Segment {segment['id']} already exists",
            )
        self._segments[segment["id"].hex] = segment
        return CreateSegmentResponse()

    @overrides(check_signature=False)
    def DeleteSegment(
        self, request: DeleteSegmentRequest, context: grpc.ServicerContext
    ) -> DeleteSegmentResponse:
        id_to_delete = request.id
        if id_to_delete in self._segments:
            del self._segments[id_to_delete]
            return DeleteSegmentResponse()
        else:
            context.abort(
                grpc.StatusCode.NOT_FOUND, f"Segment {id_to_delete} not found"
            )

    @overrides(check_signature=False)
    def GetSegments(
        self, request: GetSegmentsRequest, context: grpc.ServicerContext
    ) -> GetSegmentsResponse:
        target_id = UUID(hex=request.id) if request.HasField("id") else None
        target_type = request.type if request.HasField("type") else None
        target_scope = (
            from_proto_segment_scope(request.scope)
            if request.HasField("scope")
            else None
        )
        target_collection = UUID(hex=request.collection)

        found_segments = []
        for segment in self._segments.values():
            if target_id and segment["id"] != target_id:
                continue
            if target_type and segment["type"] != target_type:
                continue
            if target_scope and segment["scope"] != target_scope:
                continue
            if target_collection and segment["collection"] != target_collection:
                continue
            found_segments.append(segment)
        return GetSegmentsResponse(
            segments=[to_proto_segment(segment) for segment in found_segments]
        )

    @overrides(check_signature=False)
    def UpdateSegment(
        self, request: UpdateSegmentRequest, context: grpc.ServicerContext
    ) -> UpdateSegmentResponse:
        id_to_update = UUID(request.id)
        if id_to_update.hex not in self._segments:
            context.abort(
                grpc.StatusCode.NOT_FOUND, f"Segment {id_to_update} not found"
            )
        else:
            segment = self._segments[id_to_update.hex]
            if request.HasField("metadata"):
                target = cast(Dict[str, Any], segment["metadata"])
                if segment["metadata"] is None:
                    segment["metadata"] = {}
                self._merge_metadata(target, request.metadata)
            if request.HasField("reset_metadata") and request.reset_metadata:
                segment["metadata"] = {}
            return UpdateSegmentResponse()

    @overrides(check_signature=False)
    def CreateCollection(
        self, request: CreateCollectionRequest, context: grpc.ServicerContext
    ) -> CreateCollectionResponse:
        collection_name = request.name
        tenant = request.tenant
        database = request.database
        if tenant not in self._tenants_to_databases_to_collections:
            context.abort(grpc.StatusCode.NOT_FOUND, f"Tenant {tenant} not found")
        if database not in self._tenants_to_databases_to_collections[tenant]:
            context.abort(grpc.StatusCode.NOT_FOUND, f"Database {database} not found")

        # Check if the collection already exists globally by id
        for (
            search_tenant,
            databases,
        ) in self._tenants_to_databases_to_collections.items():
            for search_database, search_collections in databases.items():
                if request.id in search_collections:
                    if (
                        search_tenant != request.tenant
                        or search_database != request.database
                    ):
                        context.abort(
                            grpc.StatusCode.ALREADY_EXISTS,
                            f"Collection {request.id} already exists in tenant {search_tenant} database {search_database}",
                        )
                    elif not request.get_or_create:
                        # If the id exists for this tenant and database, and we are not doing a get_or_create, then
                        # we should return an already exists error
                        context.abort(
                            grpc.StatusCode.ALREADY_EXISTS,
                            f"Collection {request.id} already exists in tenant {search_tenant} database {search_database}",
                        )

        # Check if the collection already exists in this database by name
        collections = self._tenants_to_databases_to_collections[tenant][database]
        matches = [c for c in collections.values() if c["name"] == collection_name]
        assert len(matches) <= 1
        if len(matches) > 0:
            if request.get_or_create:
                existing_collection = matches[0]
                return CreateCollectionResponse(
                    collection=to_proto_collection(existing_collection),
                    created=False,
                )
            context.abort(
                grpc.StatusCode.ALREADY_EXISTS,
                f"Collection {collection_name} already exists",
            )

        configuration_json = json.loads(request.configuration_json_str)

        id = UUID(hex=request.id)
        new_collection = Collection(
            id=id,
            name=request.name,
            configuration_json=configuration_json,
            metadata=from_proto_metadata(request.metadata),
            dimension=request.dimension,
            database=database,
            tenant=tenant,
            version=0,
        )

        # Check that segments are unique and do not already exist
        # Keep a track of the segments that are being added
        segments_added = []
        # Create segments for the collection
        for segment_proto in request.segments:
            segment = from_proto_segment(segment_proto)
            if segment["id"].hex in self._segments:
                # Remove the already added segment since we need to roll back
                for s in segments_added:
                    self.DeleteSegment(DeleteSegmentRequest(id=s), context)
                context.abort(
                    grpc.StatusCode.ALREADY_EXISTS,
                    f"Segment {segment['id']} already exists",
                )
            self.CreateSegmentHelper(segment, context)
            segments_added.append(segment["id"].hex)

        collections[request.id] = new_collection
        collection_unique_key = f"{tenant}:{database}:{request.id}"
        self._collection_to_segments[collection_unique_key] = segments_added
        return CreateCollectionResponse(
            collection=to_proto_collection(new_collection),
            created=True,
        )

    @overrides(check_signature=False)
    def DeleteCollection(
        self, request: DeleteCollectionRequest, context: grpc.ServicerContext
    ) -> DeleteCollectionResponse:
        collection_id = request.id
        tenant = request.tenant
        database = request.database
        if tenant not in self._tenants_to_databases_to_collections:
            context.abort(grpc.StatusCode.NOT_FOUND, f"Tenant {tenant} not found")
        if database not in self._tenants_to_databases_to_collections[tenant]:
            context.abort(grpc.StatusCode.NOT_FOUND, f"Database {database} not found")
        collections = self._tenants_to_databases_to_collections[tenant][database]
        if collection_id in collections:
            del collections[collection_id]
            collection_unique_key = f"{tenant}:{database}:{collection_id}"
            segment_ids = self._collection_to_segments[collection_unique_key]
            if segment_ids:  # Delete segments if provided.
                for segment_id in segment_ids:
                    del self._segments[segment_id]
            return DeleteCollectionResponse()
        else:
            context.abort(
                grpc.StatusCode.NOT_FOUND, f"Collection {collection_id} not found"
            )

    @overrides(check_signature=False)
    def GetCollections(
        self, request: GetCollectionsRequest, context: grpc.ServicerContext
    ) -> GetCollectionsResponse:
        target_id = UUID(hex=request.id) if request.HasField("id") else None
        target_name = request.name if request.HasField("name") else None

        allCollections = {}
        for tenant, databases in self._tenants_to_databases_to_collections.items():
            for database, collections in databases.items():
                if request.tenant != "" and tenant != request.tenant:
                    continue
                if request.database != "" and database != request.database:
                    continue
                allCollections.update(collections)
                print(
                    f"Tenant: {tenant}, Database: {database}, Collections: {collections}"
                )
        found_collections = []
        for collection in allCollections.values():
            if target_id and collection["id"] != target_id:
                continue
            if target_name and collection["name"] != target_name:
                continue
            found_collections.append(collection)
        return GetCollectionsResponse(
            collections=[
                to_proto_collection(collection) for collection in found_collections
            ]
        )

    @overrides(check_signature=False)
    def CountCollections(
        self, request: CountCollectionsRequest, context: grpc.ServicerContext
    ) -> CountCollectionsResponse:
        request = GetCollectionsRequest(
            tenant=request.tenant,
            database=request.database,
        )
        collections = self.GetCollections(request, context)
        return CountCollectionsResponse(count=len(collections.collections))

    @overrides(check_signature=False)
    def GetCollectionSize(
        self, request: GetCollectionSizeRequest, context: grpc.ServicerContext
    ) -> GetCollectionSizeResponse:
        return GetCollectionSizeResponse(
            total_records_post_compaction=0,
        )

    @overrides(check_signature=False)
    def GetCollectionWithSegments(
        self, request: GetCollectionWithSegmentsRequest, context: grpc.ServicerContext
    ) -> GetCollectionWithSegmentsResponse:
        allCollections = {}
        for tenant, databases in self._tenants_to_databases_to_collections.items():
            for database, collections in databases.items():
                allCollections.update(collections)
                print(
                    f"Tenant: {tenant}, Database: {database}, Collections: {collections}"
                )
        collection = allCollections.get(request.id, None)
        if collection is None:
            context.abort(
                grpc.StatusCode.NOT_FOUND, f"Collection with id {request.id} not found"
            )
        collection_unique_key = (
            f"{collection.tenant}:{collection.database}:{request.id}"
        )
        segments = [
            self._segments[id]
            for id in self._collection_to_segments[collection_unique_key]
        ]
        if {segment["scope"] for segment in segments} != {
            SegmentScope.METADATA,
            SegmentScope.RECORD,
            SegmentScope.VECTOR,
        }:
            context.abort(
                grpc.StatusCode.INTERNAL,
                f"Incomplete segments for collection {collection}: {segments}",
            )

        return GetCollectionWithSegmentsResponse(
            collection=to_proto_collection(collection),
            segments=[to_proto_segment(segment) for segment in segments],
        )

    @overrides(check_signature=False)
    def UpdateCollection(
        self, request: UpdateCollectionRequest, context: grpc.ServicerContext
    ) -> UpdateCollectionResponse:
        id_to_update = UUID(request.id)
        # Find the collection with this id
        collections = {}
        for tenant, databases in self._tenants_to_databases_to_collections.items():
            for database, maybe_collections in databases.items():
                if id_to_update.hex in maybe_collections:
                    collections = maybe_collections

        if id_to_update.hex not in collections:
            context.abort(
                grpc.StatusCode.NOT_FOUND, f"Collection {id_to_update} not found"
            )
        else:
            collection = collections[id_to_update.hex]
            if request.HasField("name"):
                collection["name"] = request.name
            if request.HasField("dimension"):
                collection["dimension"] = request.dimension
            if request.HasField("metadata"):
                # TODO: IN SysDB SQlite we have technical debt where we
                # replace the entire metadata dict with the new one. We should
                # fix that by merging it. For now we just do the same thing here

                update_metadata = from_proto_update_metadata(request.metadata)
                cleaned_metadata = None
                if update_metadata is not None:
                    cleaned_metadata = {}
                    for key, value in update_metadata.items():
                        if value is not None:
                            cleaned_metadata[key] = value

                collection["metadata"] = cleaned_metadata
            elif request.HasField("reset_metadata"):
                if request.reset_metadata:
                    collection["metadata"] = {}

            return UpdateCollectionResponse()

    @overrides(check_signature=False)
    def ResetState(
        self, request: Empty, context: grpc.ServicerContext
    ) -> ResetStateResponse:
        self.reset_state()
        return ResetStateResponse()

    def _merge_metadata(self, target: Metadata, source: proto.UpdateMetadata) -> None:
        target_metadata = cast(Dict[str, Any], target)
        source_metadata = cast(Dict[str, Any], from_proto_update_metadata(source))
        target_metadata.update(source_metadata)
        # If a key has a None value, remove it from the metadata
        for key, value in source_metadata.items():
            if value is None and key in target:
                del target_metadata[key]
