from typing import (
    Any,
    Callable,
    cast,
    Dict,
    Sequence,
    Optional,
    Type,
    TypeVar,
    Tuple,
)
import fastapi
import orjson
from anyio import (
    to_thread,
    CapacityLimiter,
)
from fastapi import FastAPI as _FastAPI, Response, Request
from fastapi.openapi.utils import get_openapi
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import ORJSONResponse
from fastapi.routing import APIRoute
from fastapi import HTTPException, status
from functools import wraps

from chromadb.api.collection_configuration import (
    load_update_collection_configuration_from_json,
    load_create_collection_configuration_from_json,
    create_collection_configuration_from_legacy_collection_metadata,
    CreateCollectionConfiguration,
)
from pydantic import BaseModel
from chromadb import __version__ as chromadb_version
from chromadb.api.types import (
    Embedding,
    GetResult,
    QueryResult,
    Embeddings,
    convert_list_embeddings_to_np,
)
from chromadb.auth import UserIdentity
from chromadb.auth import (
    AuthzAction,
    AuthzResource,
    ServerAuthenticationProvider,
    ServerAuthorizationProvider,
)
from chromadb.config import DEFAULT_DATABASE, DEFAULT_TENANT, Settings, System
from chromadb.api import ServerAPI
from chromadb.errors import (
    ChromaError,
    InvalidDimensionException,
    InvalidHTTPVersion,
    RateLimitError,
    QuotaError,
)
from chromadb.quota import QuotaEnforcer
from chromadb.rate_limit import AsyncRateLimitEnforcer
from chromadb.server import Server
from chromadb.server.fastapi.types import (
    AddEmbedding,
    CreateDatabase,
    CreateTenant,
    DeleteEmbedding,
    GetEmbedding,
    QueryEmbedding,
    CreateCollection,
    UpdateCollection,
    UpdateEmbedding,
)
from starlette.datastructures import Headers
import logging

from chromadb.telemetry.product.events import ServerStartEvent
from chromadb.utils.fastapi import fastapi_json_response, string_to_uuid as _uuid
from opentelemetry import trace

from chromadb.telemetry.opentelemetry.fastapi import instrument_fastapi
from chromadb.types import Database, Tenant
from chromadb.telemetry.product import ServerContext, ProductTelemetryClient
from chromadb.telemetry.opentelemetry import (
    OpenTelemetryClient,
    OpenTelemetryGranularity,
    add_attributes_to_current_span,
    trace_method,
)
from chromadb.types import Collection as CollectionModel

logger = logging.getLogger(__name__)


def rate_limit(func):
    @wraps(func)
    async def wrapper(*args: Any, **kwargs: Any) -> Any:
        self = args[0]
        return await self._async_rate_limit_enforcer.rate_limit(func)(*args, **kwargs)

    return wrapper


def use_route_names_as_operation_ids(app: _FastAPI) -> None:
    """
    Simplify operation IDs so that generated API clients have simpler function
    names.
    Should be called only after all routes have been added.
    """
    for route in app.routes:
        if isinstance(route, APIRoute):
            route.operation_id = route.name + ("-v2" if "v2" in route.path else "-v1")


async def add_trace_id_to_response_middleware(
    request: Request, call_next: Callable[[Request], Any]
) -> Response:
    trace_id = trace.get_current_span().get_span_context().trace_id
    response = await call_next(request)
    response.headers["Chroma-Trace-Id"] = format(trace_id, "x")
    return response


async def catch_exceptions_middleware(
    request: Request, call_next: Callable[[Request], Any]
) -> Response:
    try:
        return await call_next(request)
    except ChromaError as e:
        return fastapi_json_response(e)
    except ValueError as e:
        return ORJSONResponse(
            content={"error": "InvalidArgumentError", "message": str(e)},
            status_code=400,
        )
    except TypeError as e:
        return ORJSONResponse(
            content={"error": "InvalidArgumentError", "message": str(e)},
            status_code=400,
        )
    except Exception as e:
        logger.exception(e)
        return ORJSONResponse(content={"error": repr(e)}, status_code=500)


async def check_http_version_middleware(
    request: Request, call_next: Callable[[Request], Any]
) -> Response:
    http_version = request.scope.get("http_version")
    if http_version not in ["1.1", "2"]:
        raise InvalidHTTPVersion(f"HTTP version {http_version} is not supported")
    return await call_next(request)


D = TypeVar("D", bound=BaseModel, contravariant=True)


def validate_model(model: Type[D], data: Any) -> D:  # type: ignore
    """Used for backward compatibility with Pydantic 1.x"""
    try:
        return model.model_validate(data)  # pydantic 2.x
    except AttributeError:
        return model.parse_obj(data)  # pydantic 1.x


class ChromaAPIRouter(fastapi.APIRouter):  # type: ignore
    # A simple subclass of fastapi's APIRouter which treats URLs with a
    # trailing "/" the same as URLs without. Docs will only contain URLs
    # without trailing "/"s.
    def add_api_route(self, path: str, *args: Any, **kwargs: Any) -> None:
        # If kwargs["include_in_schema"] isn't passed OR is True, we should
        # only include the non-"/" path. If kwargs["include_in_schema"] is
        # False, include neither.
        exclude_from_schema = (
            "include_in_schema" in kwargs and not kwargs["include_in_schema"]
        )

        def include_in_schema(path: str) -> bool:
            nonlocal exclude_from_schema
            return not exclude_from_schema and not path.endswith("/")

        kwargs["include_in_schema"] = include_in_schema(path)
        super().add_api_route(path, *args, **kwargs)

        if path.endswith("/"):
            path = path[:-1]
        else:
            path = path + "/"

        kwargs["include_in_schema"] = include_in_schema(path)
        super().add_api_route(path, *args, **kwargs)


class FastAPI(Server):
    def __init__(self, settings: Settings):
        ProductTelemetryClient.SERVER_CONTEXT = ServerContext.FASTAPI
        # https://fastapi.tiangolo.com/advanced/custom-response/#use-orjsonresponse
        self._app = fastapi.FastAPI(debug=True, default_response_class=ORJSONResponse)
        self._system = System(settings)
        self._api: ServerAPI = self._system.instance(ServerAPI)

        self._extra_openapi_schemas: Dict[str, Any] = {}
        self._app.openapi = self.generate_openapi

        self._opentelemetry_client = self._api.require(OpenTelemetryClient)
        self._capacity_limiter = CapacityLimiter(
            settings.chroma_server_thread_pool_size
        )
        self._quota_enforcer = self._system.require(QuotaEnforcer)
        self._system.start()

        self._app.middleware("http")(check_http_version_middleware)
        self._app.middleware("http")(catch_exceptions_middleware)
        self._app.middleware("http")(add_trace_id_to_response_middleware)
        self._app.add_middleware(
            CORSMiddleware,
            allow_headers=["*"],
            allow_origins=settings.chroma_server_cors_allow_origins,
            allow_methods=["*"],
        )
        self._app.add_exception_handler(QuotaError, self.quota_exception_handler)
        self._app.add_exception_handler(
            RateLimitError, self.rate_limit_exception_handler
        )
        self._async_rate_limit_enforcer = self._system.require(AsyncRateLimitEnforcer)

        self._app.on_event("shutdown")(self.shutdown)

        self.authn_provider = None
        if settings.chroma_server_authn_provider:
            self.authn_provider = self._system.require(ServerAuthenticationProvider)

        self.authz_provider = None
        if settings.chroma_server_authz_provider:
            self.authz_provider = self._system.require(ServerAuthorizationProvider)

        self.router = ChromaAPIRouter()

        self.setup_v1_routes()
        self.setup_v2_routes()

        self._app.include_router(self.router)

        use_route_names_as_operation_ids(self._app)
        instrument_fastapi(self._app)
        telemetry_client = self._system.instance(ProductTelemetryClient)
        telemetry_client.capture(ServerStartEvent())

    def generate_openapi(self) -> Dict[str, Any]:
        """Used instead of the default openapi() generation handler to include manually-populated schemas."""
        schema: Dict[str, Any] = get_openapi(
            title="Chroma",
            routes=self._app.routes,
            version=chromadb_version,
        )

        for key, value in self._extra_openapi_schemas.items():
            schema["components"]["schemas"][key] = value

        return schema

    def get_openapi_extras_for_body_model(
        self, request_model: Type[D]
    ) -> Dict[str, Any]:
        schema = request_model.model_json_schema(
            ref_template="#/components/schemas/{model}"
        )
        if "$defs" in schema:
            for key, value in schema["$defs"].items():
                self._extra_openapi_schemas[key] = value

        openapi_extra = {
            "requestBody": {
                "content": {"application/json": {"schema": schema}},
                "required": True,
            }
        }
        return openapi_extra

    def setup_v2_routes(self) -> None:
        self.router.add_api_route("/api/v2", self.root, methods=["GET"])
        self.router.add_api_route("/api/v2/reset", self.reset, methods=["POST"])
        self.router.add_api_route("/api/v2/version", self.version, methods=["GET"])
        self.router.add_api_route("/api/v2/heartbeat", self.heartbeat, methods=["GET"])
        self.router.add_api_route(
            "/api/v2/pre-flight-checks", self.pre_flight_checks, methods=["GET"]
        )

        self.router.add_api_route(
            "/api/v2/auth/identity",
            self.get_user_identity,
            methods=["GET"],
            response_model=None,
        )

        self.router.add_api_route(
            "/api/v2/tenants/{tenant}/databases",
            self.create_database,
            methods=["POST"],
            response_model=None,
            openapi_extra=self.get_openapi_extras_for_body_model(CreateDatabase),
        )

        self.router.add_api_route(
            "/api/v2/tenants/{tenant}/databases/{database_name}",
            self.get_database,
            methods=["GET"],
            response_model=None,
        )

        self.router.add_api_route(
            "/api/v2/tenants/{tenant}/databases/{database_name}",
            self.delete_database,
            methods=["DELETE"],
            response_model=None,
        )

        self.router.add_api_route(
            "/api/v2/tenants",
            self.create_tenant,
            methods=["POST"],
            response_model=None,
            openapi_extra=self.get_openapi_extras_for_body_model(CreateTenant),
        )

        self.router.add_api_route(
            "/api/v2/tenants/{tenant}",
            self.get_tenant,
            methods=["GET"],
            response_model=None,
        )

        self.router.add_api_route(
            "/api/v2/tenants/{tenant}/databases",
            self.list_databases,
            methods=["GET"],
            response_model=None,
        )

        self.router.add_api_route(
            "/api/v2/tenants/{tenant}/databases/{database_name}/collections",
            self.list_collections,
            methods=["GET"],
            response_model=None,
        )
        self.router.add_api_route(
            "/api/v2/tenants/{tenant}/databases/{database_name}/collections_count",
            self.count_collections,
            methods=["GET"],
            response_model=None,
        )
        self.router.add_api_route(
            "/api/v2/tenants/{tenant}/databases/{database_name}/collections",
            self.create_collection,
            methods=["POST"],
            response_model=None,
            openapi_extra=self.get_openapi_extras_for_body_model(CreateCollection),
        )

        self.router.add_api_route(
            "/api/v2/tenants/{tenant}/databases/{database_name}/collections/{collection_id}/add",
            self.add,
            methods=["POST"],
            status_code=status.HTTP_201_CREATED,
            response_model=None,
            openapi_extra=self.get_openapi_extras_for_body_model(AddEmbedding),
        )
        self.router.add_api_route(
            "/api/v2/tenants/{tenant}/databases/{database_name}/collections/{collection_id}/update",
            self.update,
            methods=["POST"],
            response_model=None,
            openapi_extra=self.get_openapi_extras_for_body_model(UpdateEmbedding),
        )
        self.router.add_api_route(
            "/api/v2/tenants/{tenant}/databases/{database_name}/collections/{collection_id}/upsert",
            self.upsert,
            methods=["POST"],
            response_model=None,
            openapi_extra=self.get_openapi_extras_for_body_model(AddEmbedding),
        )
        self.router.add_api_route(
            "/api/v2/tenants/{tenant}/databases/{database_name}/collections/{collection_id}/get",
            self.get,
            methods=["POST"],
            response_model=None,
            openapi_extra=self.get_openapi_extras_for_body_model(GetEmbedding),
        )
        self.router.add_api_route(
            "/api/v2/tenants/{tenant}/databases/{database_name}/collections/{collection_id}/delete",
            self.delete,
            methods=["POST"],
            response_model=None,
            openapi_extra=self.get_openapi_extras_for_body_model(DeleteEmbedding),
        )
        self.router.add_api_route(
            "/api/v2/tenants/{tenant}/databases/{database_name}/collections/{collection_id}/count",
            self.count,
            methods=["GET"],
            response_model=None,
        )
        self.router.add_api_route(
            "/api/v2/tenants/{tenant}/databases/{database_name}/collections/{collection_id}/query",
            self.get_nearest_neighbors,
            methods=["POST"],
            response_model=None,
            openapi_extra=self.get_openapi_extras_for_body_model(
                request_model=QueryEmbedding
            ),
        )
        self.router.add_api_route(
            "/api/v2/tenants/{tenant}/databases/{database_name}/collections/{collection_name}",
            self.get_collection,
            methods=["GET"],
            response_model=None,
        )
        self.router.add_api_route(
            "/api/v2/tenants/{tenant}/databases/{database_name}/collections/{collection_id}",
            self.update_collection,
            methods=["PUT"],
            response_model=None,
            openapi_extra=self.get_openapi_extras_for_body_model(UpdateCollection),
        )
        self.router.add_api_route(
            "/api/v2/tenants/{tenant}/databases/{database_name}/collections/{collection_name}",
            self.delete_collection,
            methods=["DELETE"],
            response_model=None,
        )

    def shutdown(self) -> None:
        self._system.stop()

    def app(self) -> fastapi.FastAPI:
        return self._app

    async def rate_limit_exception_handler(
        self, request: Request, exc: RateLimitError
    ) -> ORJSONResponse:
        return ORJSONResponse(
            status_code=429,
            content={"message": "Rate limit exceeded."},
        )

    def root(self) -> Dict[str, int]:
        return {"nanosecond heartbeat": self._api.heartbeat()}

    async def quota_exception_handler(
        self, request: Request, exc: QuotaError
    ) -> ORJSONResponse:
        return ORJSONResponse(
            status_code=400,
            content={"message": exc.message()},
        )

    async def heartbeat(self) -> Dict[str, int]:
        return self.root()

    async def version(self) -> str:
        return self._api.get_version()

    def _set_request_context(self, request: Request) -> None:
        """
        Set context about the request on any components that might need it.
        """
        self._quota_enforcer.set_context(context={"request": request})

    @trace_method(
        "auth_request",
        OpenTelemetryGranularity.OPERATION,
    )
    @rate_limit
    async def auth_request(
        self,
        headers: Headers,
        action: AuthzAction,
        tenant: Optional[str],
        database: Optional[str],
        collection: Optional[str],
    ) -> None:
        return await to_thread.run_sync(
            # NOTE(rescrv, iron will auth):  No need to migrate because this is the utility call.
            self.sync_auth_request,
            *(headers, action, tenant, database, collection),
        )

    @trace_method(
        "FastAPI.sync_auth_request",
        OpenTelemetryGranularity.OPERATION,
    )
    def sync_auth_request(
        self,
        headers: Headers,
        action: AuthzAction,
        tenant: Optional[str],
        database: Optional[str],
        collection: Optional[str],
    ) -> None:
        """
        Authenticates and authorizes the request based on the given headers
        and other parameters. If the request cannot be authenticated or cannot
        be authorized (with the configured providers), raises an HTTP 401.
        """
        if not self.authn_provider:
            add_attributes_to_current_span(
                {
                    "tenant": tenant,
                    "database": database,
                    "collection": collection,
                }
            )
            return

        user_identity = self.authn_provider.authenticate_or_raise(dict(headers))

        if not self.authz_provider:
            return

        authz_resource = AuthzResource(
            tenant=tenant,
            database=database,
            collection=collection,
        )

        self.authz_provider.authorize_or_raise(user_identity, action, authz_resource)
        add_attributes_to_current_span(
            {
                "tenant": tenant,
                "database": database,
                "collection": collection,
            }
        )
        return

    @trace_method("FastAPI.get_user_identity", OpenTelemetryGranularity.OPERATION)
    async def get_user_identity(
        self,
        request: Request,
    ) -> UserIdentity:
        if not self.authn_provider:
            return UserIdentity(
                user_id="", tenant=DEFAULT_TENANT, databases=[DEFAULT_DATABASE]
            )

        return cast(
            UserIdentity,
            await to_thread.run_sync(
                lambda: cast(ServerAuthenticationProvider, self.authn_provider).authenticate_or_raise(dict(request.headers))  # type: ignore
            ),
        )

    @trace_method("FastAPI.create_database", OpenTelemetryGranularity.OPERATION)
    async def create_database(
        self,
        request: Request,
        tenant: str,
    ) -> None:
        def process_create_database(
            tenant: str, headers: Headers, raw_body: bytes
        ) -> None:
            db = validate_model(CreateDatabase, orjson.loads(raw_body))

            # NOTE(rescrv, iron will auth):  Implemented.
            self.sync_auth_request(
                headers,
                AuthzAction.CREATE_DATABASE,
                tenant,
                db.name,
                None,
            )

            self._set_request_context(request=request)

            return self._api.create_database(db.name, tenant)

        await to_thread.run_sync(
            process_create_database,
            tenant,
            request.headers,
            await request.body(),
            limiter=self._capacity_limiter,
        )

    @trace_method("FastAPI.get_database", OpenTelemetryGranularity.OPERATION)
    async def get_database(
        self,
        request: Request,
        database_name: str,
        tenant: str,
    ) -> Database:
        # NOTE(rescrv, iron will auth):  Implemented.
        await self.auth_request(
            request.headers,
            AuthzAction.GET_DATABASE,
            tenant,
            database_name,
            None,
        )

        return cast(
            Database,
            await to_thread.run_sync(
                self._api.get_database,
                database_name,
                tenant,
                limiter=self._capacity_limiter,
            ),
        )

    @trace_method("FastAPI.delete_database", OpenTelemetryGranularity.OPERATION)
    async def delete_database(
        self,
        request: Request,
        database_name: str,
        tenant: str,
    ) -> None:
        # NOTE(rescrv, iron will auth):  Implemented.
        self.auth_request(
            request.headers,
            AuthzAction.DELETE_DATABASE,
            tenant,
            database_name,
            None,
        )

        await to_thread.run_sync(
            self._api.delete_database,
            database_name,
            tenant,
            limiter=self._capacity_limiter,
        )

    @trace_method("FastAPI.create_tenant", OpenTelemetryGranularity.OPERATION)
    async def create_tenant(
        self,
        request: Request,
    ) -> None:
        def process_create_tenant(request: Request, raw_body: bytes) -> None:
            tenant = validate_model(CreateTenant, orjson.loads(raw_body))

            # NOTE(rescrv, iron will auth):  Implemented.
            self.sync_auth_request(
                request.headers,
                AuthzAction.CREATE_TENANT,
                tenant.name,
                None,
                None,
            )

            return self._api.create_tenant(tenant.name)

        await to_thread.run_sync(
            process_create_tenant,
            request,
            await request.body(),
            limiter=self._capacity_limiter,
        )

    @trace_method("FastAPI.get_tenant", OpenTelemetryGranularity.OPERATION)
    async def get_tenant(
        self,
        request: Request,
        tenant: str,
    ) -> Tenant:
        # NOTE(rescrv, iron will auth):  Implemented.
        await self.auth_request(
            request.headers,
            AuthzAction.GET_TENANT,
            tenant,
            None,
            None,
        )

        return cast(
            Tenant,
            await to_thread.run_sync(
                self._api.get_tenant,
                tenant,
                limiter=self._capacity_limiter,
            ),
        )

    @trace_method("FastAPI.list_databases", OpenTelemetryGranularity.OPERATION)
    async def list_databases(
        self,
        request: Request,
        tenant: str,
        limit: Optional[int] = None,
        offset: Optional[int] = None,
    ) -> Sequence[Database]:
        # NOTE(rescrv, iron will auth):  Implemented.
        await self.auth_request(
            request.headers,
            AuthzAction.LIST_DATABASES,
            tenant,
            None,
            None,
        )

        return cast(
            Sequence[Database],
            await to_thread.run_sync(
                self._api.list_databases,
                limit,
                offset,
                tenant,
                limiter=self._capacity_limiter,
            ),
        )

    @trace_method("FastAPI.list_collections", OpenTelemetryGranularity.OPERATION)
    async def list_collections(
        self,
        request: Request,
        tenant: str,
        database_name: str,
        limit: Optional[int] = None,
        offset: Optional[int] = None,
    ) -> Sequence[CollectionModel]:
        def process_list_collections(
            limit: Optional[int], offset: Optional[int], tenant: str, database_name: str
        ) -> Sequence[CollectionModel]:
            # NOTE(rescrv, iron will auth):  Implemented.
            self.sync_auth_request(
                request.headers,
                AuthzAction.LIST_COLLECTIONS,
                tenant,
                database_name,
                None,
            )

            self._set_request_context(request=request)

            add_attributes_to_current_span({"tenant": tenant})
            return self._api.list_collections(
                tenant=tenant, database=database_name, limit=limit, offset=offset
            )

        api_collection_models = cast(
            Sequence[CollectionModel],
            await to_thread.run_sync(
                process_list_collections,
                limit,
                offset,
                tenant,
                database_name,
                limiter=self._capacity_limiter,
            ),
        )

        return api_collection_models

    @trace_method("FastAPI.count_collections", OpenTelemetryGranularity.OPERATION)
    async def count_collections(
        self,
        request: Request,
        tenant: str,
        database_name: str,
    ) -> int:
        # NOTE(rescrv, iron will auth):  Implemented.
        await self.auth_request(
            request.headers,
            AuthzAction.COUNT_COLLECTIONS,
            tenant,
            database_name,
            None,
        )

        add_attributes_to_current_span({"tenant": tenant})

        return cast(
            int,
            await to_thread.run_sync(
                self._api.count_collections,
                tenant,
                database_name,
                limiter=self._capacity_limiter,
            ),
        )

    @trace_method("FastAPI.create_collection", OpenTelemetryGranularity.OPERATION)
    async def create_collection(
        self,
        request: Request,
        tenant: str,
        database_name: str,
    ) -> CollectionModel:
        def process_create_collection(
            request: Request, tenant: str, database: str, raw_body: bytes
        ) -> CollectionModel:
            create = validate_model(CreateCollection, orjson.loads(raw_body))
            if not create.configuration:
                if create.metadata:
                    configuration = (
                        create_collection_configuration_from_legacy_collection_metadata(
                            create.metadata
                        )
                    )
                else:
                    configuration = None
            else:
                configuration = load_create_collection_configuration_from_json(
                    create.configuration
                )

            # NOTE(rescrv, iron will auth):  Implemented.
            self.sync_auth_request(
                request.headers,
                AuthzAction.CREATE_COLLECTION,
                tenant,
                database,
                create.name,
            )

            self._set_request_context(request=request)

            add_attributes_to_current_span({"tenant": tenant})

            return self._api.create_collection(
                name=create.name,
                configuration=configuration,
                metadata=create.metadata,
                get_or_create=create.get_or_create,
                tenant=tenant,
                database=database,
            )

        api_collection_model = cast(
            CollectionModel,
            await to_thread.run_sync(
                process_create_collection,
                request,
                tenant,
                database_name,
                await request.body(),
                limiter=self._capacity_limiter,
            ),
        )
        return api_collection_model

    @trace_method("FastAPI.get_collection", OpenTelemetryGranularity.OPERATION)
    async def get_collection(
        self,
        request: Request,
        tenant: str,
        database_name: str,
        collection_name: str,
    ) -> CollectionModel:
        # NOTE(rescrv, iron will auth):  Implemented.
        await self.auth_request(
            request.headers,
            AuthzAction.GET_COLLECTION,
            tenant,
            database_name,
            collection_name,
        )

        add_attributes_to_current_span({"tenant": tenant})

        api_collection_model = cast(
            CollectionModel,
            await to_thread.run_sync(
                self._api.get_collection,
                collection_name,
                tenant,
                database_name,
                limiter=self._capacity_limiter,
            ),
        )
        return api_collection_model

    @trace_method("FastAPI.update_collection", OpenTelemetryGranularity.OPERATION)
    async def update_collection(
        self,
        tenant: str,
        database_name: str,
        collection_id: str,
        request: Request,
    ) -> None:
        def process_update_collection(
            request: Request, collection_id: str, raw_body: bytes
        ) -> None:
            update = validate_model(UpdateCollection, orjson.loads(raw_body))
            # NOTE(rescrv, iron will auth):  Implemented.
            self.sync_auth_request(
                request.headers,
                AuthzAction.UPDATE_COLLECTION,
                tenant,
                database_name,
                collection_id,
            )
            configuration = (
                None
                if not update.new_configuration
                else load_update_collection_configuration_from_json(
                    update.new_configuration
                )
            )
            self._set_request_context(request=request)
            add_attributes_to_current_span({"tenant": tenant})
            return self._api._modify(
                id=_uuid(collection_id),
                new_name=update.new_name,
                new_metadata=update.new_metadata,
                new_configuration=configuration,
                tenant=tenant,
                database=database_name,
            )

        await to_thread.run_sync(
            process_update_collection,
            request,
            collection_id,
            await request.body(),
            limiter=self._capacity_limiter,
        )

    @trace_method("FastAPI.delete_collection", OpenTelemetryGranularity.OPERATION)
    async def delete_collection(
        self,
        request: Request,
        collection_name: str,
        tenant: str,
        database_name: str,
    ) -> None:
        # NOTE(rescrv, iron will auth):  Implemented.
        await self.auth_request(
            request.headers,
            AuthzAction.DELETE_COLLECTION,
            tenant,
            database_name,
            collection_name,
        )
        add_attributes_to_current_span({"tenant": tenant})

        await to_thread.run_sync(
            self._api.delete_collection,
            collection_name,
            tenant,
            database_name,
            limiter=self._capacity_limiter,
        )

    @trace_method("FastAPI.add", OpenTelemetryGranularity.OPERATION)
    @rate_limit
    async def add(
        self,
        request: Request,
        tenant: str,
        database_name: str,
        collection_id: str,
    ) -> bool:
        try:

            def process_add(request: Request, raw_body: bytes) -> bool:
                add = validate_model(AddEmbedding, orjson.loads(raw_body))
                # NOTE(rescrv, iron will auth):  Implemented.
                self.sync_auth_request(
                    request.headers,
                    AuthzAction.ADD,
                    tenant,
                    database_name,
                    collection_id,
                )
                self._set_request_context(request=request)
                add_attributes_to_current_span({"tenant": tenant})
                return self._api._add(
                    collection_id=_uuid(collection_id),
                    ids=add.ids,
                    embeddings=cast(
                        Embeddings,
                        convert_list_embeddings_to_np(add.embeddings)
                        if add.embeddings
                        else None,
                    ),
                    metadatas=add.metadatas,  # type: ignore
                    documents=add.documents,  # type: ignore
                    uris=add.uris,  # type: ignore
                    tenant=tenant,
                    database=database_name,
                )

            return cast(
                bool,
                await to_thread.run_sync(
                    process_add,
                    request,
                    await request.body(),
                    limiter=self._capacity_limiter,
                ),
            )
        except InvalidDimensionException as e:
            raise HTTPException(status_code=500, detail=str(e))

    @trace_method("FastAPI.update", OpenTelemetryGranularity.OPERATION)
    @rate_limit
    async def update(
        self,
        request: Request,
        tenant: str,
        database_name: str,
        collection_id: str,
    ) -> None:
        def process_update(request: Request, raw_body: bytes) -> bool:
            update = validate_model(UpdateEmbedding, orjson.loads(raw_body))

            # NOTE(rescrv, iron will auth):  Implemented.
            self.sync_auth_request(
                request.headers,
                AuthzAction.UPDATE,
                tenant,
                database_name,
                collection_id,
            )
            self._set_request_context(request=request)
            add_attributes_to_current_span({"tenant": tenant})

            return self._api._update(
                collection_id=_uuid(collection_id),
                ids=update.ids,
                embeddings=convert_list_embeddings_to_np(update.embeddings)
                if update.embeddings
                else None,
                metadatas=update.metadatas,  # type: ignore
                documents=update.documents,  # type: ignore
                uris=update.uris,  # type: ignore
                tenant=tenant,
                database=database_name,
            )

        await to_thread.run_sync(
            process_update,
            request,
            await request.body(),
            limiter=self._capacity_limiter,
        )

    @trace_method("FastAPI.upsert", OpenTelemetryGranularity.OPERATION)
    @rate_limit
    async def upsert(
        self,
        request: Request,
        tenant: str,
        database_name: str,
        collection_id: str,
    ) -> None:
        def process_upsert(request: Request, raw_body: bytes) -> bool:
            upsert = validate_model(AddEmbedding, orjson.loads(raw_body))

            # NOTE(rescrv, iron will auth):  Implemented.
            self.sync_auth_request(
                request.headers,
                AuthzAction.UPSERT,
                tenant,
                database_name,
                collection_id,
            )
            self._set_request_context(request=request)
            add_attributes_to_current_span({"tenant": tenant})

            return self._api._upsert(
                collection_id=_uuid(collection_id),
                ids=upsert.ids,
                embeddings=cast(
                    Embeddings,
                    convert_list_embeddings_to_np(upsert.embeddings)
                    if upsert.embeddings
                    else None,
                ),
                metadatas=upsert.metadatas,  # type: ignore
                documents=upsert.documents,  # type: ignore
                uris=upsert.uris,  # type: ignore
                tenant=tenant,
                database=database_name,
            )

        await to_thread.run_sync(
            process_upsert,
            request,
            await request.body(),
            limiter=self._capacity_limiter,
        )

    @trace_method("FastAPI.get", OpenTelemetryGranularity.OPERATION)
    @rate_limit
    async def get(
        self,
        collection_id: str,
        tenant: str,
        database_name: str,
        request: Request,
    ) -> GetResult:
        def process_get(request: Request, raw_body: bytes) -> GetResult:
            get = validate_model(GetEmbedding, orjson.loads(raw_body))
            # NOTE(rescrv, iron will auth):  Implemented.
            self.sync_auth_request(
                request.headers,
                AuthzAction.GET,
                tenant,
                database_name,
                collection_id,
            )
            self._set_request_context(request=request)
            add_attributes_to_current_span({"tenant": tenant})
            return self._api._get(
                collection_id=_uuid(collection_id),
                ids=get.ids,
                where=get.where,
                limit=get.limit,
                offset=get.offset,
                where_document=get.where_document,
                include=get.include,
                tenant=tenant,
                database=database_name,
            )

        get_result = cast(
            GetResult,
            await to_thread.run_sync(
                process_get,
                request,
                await request.body(),
                limiter=self._capacity_limiter,
            ),
        )

        if get_result["embeddings"] is not None:
            get_result["embeddings"] = [
                cast(Embedding, embedding).tolist()
                for embedding in get_result["embeddings"]
            ]

        return get_result

    @trace_method("FastAPI.delete", OpenTelemetryGranularity.OPERATION)
    @rate_limit
    async def delete(
        self,
        collection_id: str,
        tenant: str,
        database_name: str,
        request: Request,
    ) -> None:
        def process_delete(request: Request, raw_body: bytes) -> None:
            delete = validate_model(DeleteEmbedding, orjson.loads(raw_body))
            # NOTE(rescrv, iron will auth):  Implemented.
            self.sync_auth_request(
                request.headers,
                AuthzAction.DELETE,
                tenant,
                database_name,
                collection_id,
            )
            self._set_request_context(request=request)
            add_attributes_to_current_span({"tenant": tenant})
            return self._api._delete(
                collection_id=_uuid(collection_id),
                ids=delete.ids,
                where=delete.where,
                where_document=delete.where_document,
                tenant=tenant,
                database=database_name,
            )

        await to_thread.run_sync(
            process_delete,
            request,
            await request.body(),
            limiter=self._capacity_limiter,
        )

    @trace_method("FastAPI.count", OpenTelemetryGranularity.OPERATION)
    @rate_limit
    async def count(
        self,
        request: Request,
        tenant: str,
        database_name: str,
        collection_id: str,
    ) -> int:
        # NOTE(rescrv, iron will auth):  Implemented.
        await self.auth_request(
            request.headers,
            AuthzAction.COUNT,
            tenant,
            database_name,
            collection_id,
        )
        add_attributes_to_current_span({"tenant": tenant})

        return cast(
            int,
            await to_thread.run_sync(
                self._api._count,
                _uuid(collection_id),
                tenant,
                database_name,
                limiter=self._capacity_limiter,
            ),
        )

    @trace_method("FastAPI.reset", OpenTelemetryGranularity.OPERATION)
    @rate_limit
    async def reset(
        self,
        request: Request,
    ) -> bool:
        # NOTE(rescrv, iron will auth):  Implemented.
        await self.auth_request(
            request.headers,
            AuthzAction.RESET,
            None,
            None,
            None,
        )

        return cast(
            bool,
            await to_thread.run_sync(
                self._api.reset,
                limiter=self._capacity_limiter,
            ),
        )

    @trace_method("FastAPI.get_nearest_neighbors", OpenTelemetryGranularity.OPERATION)
    @rate_limit
    async def get_nearest_neighbors(
        self,
        tenant: str,
        database_name: str,
        collection_id: str,
        request: Request,
    ) -> QueryResult:
        @trace_method(
            "internal.get_nearest_neighbors", OpenTelemetryGranularity.OPERATION
        )
        def process_query(request: Request, raw_body: bytes) -> QueryResult:
            query = validate_model(QueryEmbedding, orjson.loads(raw_body))

            # NOTE(rescrv, iron will auth):  Implemented.
            self.sync_auth_request(
                request.headers,
                AuthzAction.QUERY,
                tenant,
                database_name,
                collection_id,
            )
            self._set_request_context(request=request)
            add_attributes_to_current_span({"tenant": tenant})

            return self._api._query(
                collection_id=_uuid(collection_id),
                query_embeddings=cast(
                    Embeddings,
                    convert_list_embeddings_to_np(query.query_embeddings)
                    if query.query_embeddings
                    else None,
                ),
                n_results=query.n_results,
                where=query.where,
                where_document=query.where_document,
                include=query.include,
                tenant=tenant,
                database=database_name,
            )

        nnresult = cast(
            QueryResult,
            await to_thread.run_sync(
                process_query,
                request,
                await request.body(),
                limiter=self._capacity_limiter,
            ),
        )

        if nnresult["embeddings"] is not None:
            nnresult["embeddings"] = [
                [cast(Embedding, embedding).tolist() for embedding in result]
                for result in nnresult["embeddings"]
            ]

        return nnresult

    async def pre_flight_checks(self) -> Dict[str, Any]:
        def process_pre_flight_checks() -> Dict[str, Any]:
            return {
                "max_batch_size": self._api.get_max_batch_size(),
            }

        return cast(
            Dict[str, Any],
            await to_thread.run_sync(
                process_pre_flight_checks,
                limiter=self._capacity_limiter,
            ),
        )

    # =========================================================================
    # OLD ROUTES FOR BACKWARDS COMPATIBILITY — WILL BE REMOVED
    # =========================================================================
    def setup_v1_routes(self) -> None:
        self.router.add_api_route("/api/v1", self.root, methods=["GET"])
        self.router.add_api_route("/api/v1/reset", self.reset, methods=["POST"])
        self.router.add_api_route("/api/v1/version", self.version, methods=["GET"])
        self.router.add_api_route("/api/v1/heartbeat", self.heartbeat, methods=["GET"])
        self.router.add_api_route(
            "/api/v1/pre-flight-checks", self.pre_flight_checks, methods=["GET"]
        )

        self.router.add_api_route(
            "/api/v1/databases",
            self.create_database_v1,
            methods=["POST"],
            response_model=None,
            openapi_extra=self.get_openapi_extras_for_body_model(CreateDatabase),
        )

        self.router.add_api_route(
            "/api/v1/databases/{database}",
            self.get_database_v1,
            methods=["GET"],
            response_model=None,
        )

        self.router.add_api_route(
            "/api/v1/tenants",
            self.create_tenant_v1,
            methods=["POST"],
            response_model=None,
            openapi_extra=self.get_openapi_extras_for_body_model(CreateTenant),
        )

        self.router.add_api_route(
            "/api/v1/tenants/{tenant}",
            self.get_tenant_v1,
            methods=["GET"],
            response_model=None,
        )

        self.router.add_api_route(
            "/api/v1/collections",
            self.list_collections_v1,
            methods=["GET"],
            response_model=None,
        )
        self.router.add_api_route(
            "/api/v1/count_collections",
            self.count_collections_v1,
            methods=["GET"],
            response_model=None,
        )
        self.router.add_api_route(
            "/api/v1/collections",
            self.create_collection_v1,
            methods=["POST"],
            response_model=None,
            openapi_extra=self.get_openapi_extras_for_body_model(CreateCollection),
        )

        self.router.add_api_route(
            "/api/v1/collections/{collection_id}/add",
            self.add_v1,
            methods=["POST"],
            status_code=status.HTTP_201_CREATED,
            response_model=None,
            openapi_extra=self.get_openapi_extras_for_body_model(AddEmbedding),
        )
        self.router.add_api_route(
            "/api/v1/collections/{collection_id}/update",
            self.update_v1,
            methods=["POST"],
            response_model=None,
            openapi_extra=self.get_openapi_extras_for_body_model(UpdateEmbedding),
        )
        self.router.add_api_route(
            "/api/v1/collections/{collection_id}/upsert",
            self.upsert_v1,
            methods=["POST"],
            response_model=None,
            openapi_extra=self.get_openapi_extras_for_body_model(AddEmbedding),
        )
        self.router.add_api_route(
            "/api/v1/collections/{collection_id}/get",
            self.get_v1,
            methods=["POST"],
            response_model=None,
            openapi_extra=self.get_openapi_extras_for_body_model(GetEmbedding),
        )
        self.router.add_api_route(
            "/api/v1/collections/{collection_id}/delete",
            self.delete_v1,
            methods=["POST"],
            response_model=None,
            openapi_extra=self.get_openapi_extras_for_body_model(DeleteEmbedding),
        )
        self.router.add_api_route(
            "/api/v1/collections/{collection_id}/count",
            self.count_v1,
            methods=["GET"],
            response_model=None,
        )
        self.router.add_api_route(
            "/api/v1/collections/{collection_id}/query",
            self.get_nearest_neighbors_v1,
            methods=["POST"],
            response_model=None,
            openapi_extra=self.get_openapi_extras_for_body_model(QueryEmbedding),
        )
        self.router.add_api_route(
            "/api/v1/collections/{collection_name}",
            self.get_collection_v1,
            methods=["GET"],
            response_model=None,
        )
        self.router.add_api_route(
            "/api/v1/collections/{collection_id}",
            self.update_collection_v1,
            methods=["PUT"],
            response_model=None,
            openapi_extra=self.get_openapi_extras_for_body_model(UpdateCollection),
        )
        self.router.add_api_route(
            "/api/v1/collections/{collection_name}",
            self.delete_collection_v1,
            methods=["DELETE"],
            response_model=None,
        )

    @trace_method(
        "auth_and_get_tenant_and_database_for_request_v1",
        OpenTelemetryGranularity.OPERATION,
    )
    @rate_limit
    async def auth_and_get_tenant_and_database_for_request(
        self,
        headers: Headers,
        action: AuthzAction,
        tenant: Optional[str],
        database: Optional[str],
        collection: Optional[str],
    ) -> Tuple[Optional[str], Optional[str]]:
        """
        Authenticates and authorizes the request based on the given headers
        and other parameters. If the request cannot be authenticated or cannot
        be authorized (with the configured providers), raises an HTTP 401.

        If the request is authenticated and authorized, returns the tenant and
        database to be used for the request. These will differ from the passed
        tenant and database if and only if:
        - The request is authenticated
        - chroma_overwrite_singleton_tenant_database_access_from_auth = True
        - The passed tenant or database are None or default_{tenant, database}
            (can be overwritten separately)
        - The user has access to a single tenant and/or single database.
        """
        return await to_thread.run_sync(
            # NOTE(rescrv, iron will auth):  v1
            self.sync_auth_and_get_tenant_and_database_for_request,
            headers,
            action,
            tenant,
            database,
            collection,
        )

    # NOTE(rescrv, iron will auth):  v1
    def sync_auth_and_get_tenant_and_database_for_request(
        self,
        headers: Headers,
        action: AuthzAction,
        tenant: Optional[str],
        database: Optional[str],
        collection: Optional[str],
    ) -> Tuple[Optional[str], Optional[str]]:
        if not self.authn_provider:
            add_attributes_to_current_span(
                {
                    "tenant": tenant,
                    "database": database,
                    "collection": collection,
                }
            )
            return (tenant, database)

        user_identity = self.authn_provider.authenticate_or_raise(dict(headers))

        (
            new_tenant,
            new_database,
        ) = self.authn_provider.singleton_tenant_database_if_applicable(user_identity)

        if (not tenant or tenant == DEFAULT_TENANT) and new_tenant:
            tenant = new_tenant
        if (not database or database == DEFAULT_DATABASE) and new_database:
            database = new_database

        if not self.authz_provider:
            return (tenant, database)

        authz_resource = AuthzResource(
            tenant=tenant,
            database=database,
            collection=collection,
        )

        self.authz_provider.authorize_or_raise(user_identity, action, authz_resource)
        add_attributes_to_current_span(
            {
                "tenant": tenant,
                "database": database,
                "collection": collection,
            }
        )
        return (tenant, database)

    @trace_method("FastAPI.create_database_v1", OpenTelemetryGranularity.OPERATION)
    @rate_limit
    async def create_database_v1(
        self,
        request: Request,
        tenant: str = DEFAULT_TENANT,
    ) -> None:
        def process_create_database(
            tenant: str, headers: Headers, raw_body: bytes
        ) -> None:
            db = validate_model(CreateDatabase, orjson.loads(raw_body))

            (
                maybe_tenant,
                maybe_database,
                # NOTE(rescrv, iron will auth):  v1
            ) = self.sync_auth_and_get_tenant_and_database_for_request(
                headers,
                AuthzAction.CREATE_DATABASE,
                tenant,
                db.name,
                None,
            )
            if maybe_tenant:
                tenant = maybe_tenant
            if maybe_database:
                db.name = maybe_database

            return self._api.create_database(db.name, tenant)

        await to_thread.run_sync(
            process_create_database,
            tenant,
            request.headers,
            await request.body(),
            limiter=self._capacity_limiter,
        )

    @trace_method("FastAPI.get_database_v1", OpenTelemetryGranularity.OPERATION)
    @rate_limit
    async def get_database_v1(
        self,
        request: Request,
        database: str,
        tenant: str = DEFAULT_TENANT,
    ) -> Database:
        (
            maybe_tenant,
            maybe_database,
        ) = await self.auth_and_get_tenant_and_database_for_request(
            request.headers,
            AuthzAction.GET_DATABASE,
            tenant,
            database,
            None,
        )
        if maybe_tenant:
            tenant = maybe_tenant
        if maybe_database:
            database = maybe_database

        return cast(
            Database,
            await to_thread.run_sync(
                self._api.get_database,
                database,
                tenant,
                limiter=self._capacity_limiter,
            ),
        )

    @trace_method("FastAPI.create_tenant_v1", OpenTelemetryGranularity.OPERATION)
    @rate_limit
    async def create_tenant_v1(
        self,
        request: Request,
    ) -> None:
        def process_create_tenant(request: Request, raw_body: bytes) -> None:
            tenant = validate_model(CreateTenant, orjson.loads(raw_body))

            # NOTE(rescrv, iron will auth):  v1
            maybe_tenant, _ = self.sync_auth_and_get_tenant_and_database_for_request(
                request.headers,
                AuthzAction.CREATE_TENANT,
                tenant.name,
                None,
                None,
            )
            if maybe_tenant:
                tenant.name = maybe_tenant

            return self._api.create_tenant(tenant.name)

        await to_thread.run_sync(
            process_create_tenant,
            request,
            await request.body(),
            limiter=self._capacity_limiter,
        )

    @trace_method("FastAPI.get_tenant_v1", OpenTelemetryGranularity.OPERATION)
    @rate_limit
    async def get_tenant_v1(
        self,
        request: Request,
        tenant: str,
    ) -> Tenant:
        maybe_tenant, _ = await self.auth_and_get_tenant_and_database_for_request(
            request.headers,
            AuthzAction.GET_TENANT,
            tenant,
            None,
            None,
        )
        if maybe_tenant:
            tenant = maybe_tenant

        return cast(
            Tenant,
            await to_thread.run_sync(
                self._api.get_tenant,
                tenant,
                limiter=self._capacity_limiter,
            ),
        )

    @trace_method("FastAPI.list_collections_v1", OpenTelemetryGranularity.OPERATION)
    @rate_limit
    async def list_collections_v1(
        self,
        request: Request,
        limit: Optional[int] = None,
        offset: Optional[int] = None,
        tenant: str = DEFAULT_TENANT,
        database: str = DEFAULT_DATABASE,
    ) -> Sequence[CollectionModel]:
        (
            maybe_tenant,
            maybe_database,
        ) = await self.auth_and_get_tenant_and_database_for_request(
            request.headers,
            AuthzAction.LIST_COLLECTIONS,
            tenant,
            database,
            None,
        )
        if maybe_tenant:
            tenant = maybe_tenant
        if maybe_database:
            database = maybe_database

        api_collection_models = cast(
            Sequence[CollectionModel],
            await to_thread.run_sync(
                self._api.list_collections,
                limit,
                offset,
                tenant,
                database,
                limiter=self._capacity_limiter,
            ),
        )

        return api_collection_models

    @trace_method("FastAPI.count_collections_v1", OpenTelemetryGranularity.OPERATION)
    @rate_limit
    async def count_collections_v1(
        self,
        request: Request,
        tenant: str = DEFAULT_TENANT,
        database: str = DEFAULT_DATABASE,
    ) -> int:
        (
            maybe_tenant,
            maybe_database,
        ) = await self.auth_and_get_tenant_and_database_for_request(
            request.headers,
            AuthzAction.COUNT_COLLECTIONS,
            tenant,
            database,
            None,
        )
        if maybe_tenant:
            tenant = maybe_tenant
        if maybe_database:
            database = maybe_database

        return cast(
            int,
            await to_thread.run_sync(
                self._api.count_collections,
                tenant,
                database,
                limiter=self._capacity_limiter,
            ),
        )

    @trace_method("FastAPI.create_collection_v1", OpenTelemetryGranularity.OPERATION)
    @rate_limit
    async def create_collection_v1(
        self,
        request: Request,
        tenant: str = DEFAULT_TENANT,
        database: str = DEFAULT_DATABASE,
    ) -> CollectionModel:
        def process_create_collection(
            request: Request, tenant: str, database: str, raw_body: bytes
        ) -> CollectionModel:
            create = validate_model(CreateCollection, orjson.loads(raw_body))
            configuration = (
                CreateCollectionConfiguration()
                if not create.configuration
                else load_create_collection_configuration_from_json(
                    create.configuration
                )
            )

            (
                maybe_tenant,
                maybe_database,
                # NOTE(rescrv, iron will auth):  v1
            ) = self.sync_auth_and_get_tenant_and_database_for_request(
                request.headers,
                AuthzAction.CREATE_COLLECTION,
                tenant,
                database,
                create.name,
            )
            if maybe_tenant:
                tenant = maybe_tenant
            if maybe_database:
                database = maybe_database

            return self._api.create_collection(
                name=create.name,
                configuration=configuration,
                metadata=create.metadata,
                get_or_create=create.get_or_create,
                tenant=tenant,
                database=database,
            )

        api_collection_model = cast(
            CollectionModel,
            await to_thread.run_sync(
                process_create_collection,
                request,
                tenant,
                database,
                await request.body(),
                limiter=self._capacity_limiter,
            ),
        )
        return api_collection_model

    @trace_method("FastAPI.get_collection_v1", OpenTelemetryGranularity.OPERATION)
    @rate_limit
    async def get_collection_v1(
        self,
        request: Request,
        collection_name: str,
        tenant: str = DEFAULT_TENANT,
        database: str = DEFAULT_DATABASE,
    ) -> CollectionModel:
        (
            maybe_tenant,
            maybe_database,
        ) = await self.auth_and_get_tenant_and_database_for_request(
            request.headers,
            AuthzAction.GET_COLLECTION,
            tenant,
            database,
            collection_name,
        )
        if maybe_tenant:
            tenant = maybe_tenant
        if maybe_database:
            database = maybe_database

        async def inner():
            api_collection_model = cast(
                CollectionModel,
                await to_thread.run_sync(
                    self._api.get_collection,
                    collection_name,
                    tenant,
                    database,
                    limiter=self._capacity_limiter,
                ),
            )
            return api_collection_model

        return await inner()

    @trace_method("FastAPI.update_collection_v1", OpenTelemetryGranularity.OPERATION)
    @rate_limit
    async def update_collection_v1(
        self,
        collection_id: str,
        request: Request,
    ) -> None:
        def process_update_collection(
            request: Request, collection_id: str, raw_body: bytes
        ) -> None:
            update = validate_model(UpdateCollection, orjson.loads(raw_body))
            # NOTE(rescrv, iron will auth):  v1
            self.sync_auth_and_get_tenant_and_database_for_request(
                request.headers,
                AuthzAction.UPDATE_COLLECTION,
                None,
                None,
                collection_id,
            )
            configuration = (
                None
                if not update.new_configuration
                else load_update_collection_configuration_from_json(
                    update.new_configuration
                )
            )
            return self._api._modify(
                id=_uuid(collection_id),
                new_name=update.new_name,
                new_metadata=update.new_metadata,
                new_configuration=configuration,
            )

        await to_thread.run_sync(
            process_update_collection,
            request,
            collection_id,
            await request.body(),
            limiter=self._capacity_limiter,
        )

    @trace_method("FastAPI.delete_collection_v1", OpenTelemetryGranularity.OPERATION)
    @rate_limit
    async def delete_collection_v1(
        self,
        request: Request,
        collection_name: str,
        tenant: str = DEFAULT_TENANT,
        database: str = DEFAULT_DATABASE,
    ) -> None:
        (
            maybe_tenant,
            maybe_database,
        ) = await self.auth_and_get_tenant_and_database_for_request(
            request.headers,
            AuthzAction.DELETE_COLLECTION,
            tenant,
            database,
            collection_name,
        )
        if maybe_tenant:
            tenant = maybe_tenant
        if maybe_database:
            database = maybe_database

        await to_thread.run_sync(
            self._api.delete_collection,
            collection_name,
            tenant,
            database,
            limiter=self._capacity_limiter,
        )

    @trace_method("FastAPI.add_v1", OpenTelemetryGranularity.OPERATION)
    @rate_limit
    async def add_v1(
        self,
        request: Request,
        collection_id: str,
    ) -> bool:
        try:

            def process_add(request: Request, raw_body: bytes) -> bool:
                add = validate_model(AddEmbedding, orjson.loads(raw_body))
                # NOTE(rescrv, iron will auth):  v1
                self.sync_auth_and_get_tenant_and_database_for_request(
                    request.headers,
                    AuthzAction.ADD,
                    None,
                    None,
                    collection_id,
                )
                return self._api._add(
                    collection_id=_uuid(collection_id),
                    ids=add.ids,
                    embeddings=cast(
                        Embeddings,
                        convert_list_embeddings_to_np(add.embeddings)
                        if add.embeddings
                        else None,
                    ),
                    metadatas=add.metadatas,  # type: ignore
                    documents=add.documents,  # type: ignore
                    uris=add.uris,  # type: ignore
                )

            return cast(
                bool,
                await to_thread.run_sync(
                    process_add,
                    request,
                    await request.body(),
                    limiter=self._capacity_limiter,
                ),
            )
        except InvalidDimensionException as e:
            raise HTTPException(status_code=500, detail=str(e))

    @trace_method("FastAPI.update_v1", OpenTelemetryGranularity.OPERATION)
    async def update_v1(
        self,
        request: Request,
        collection_id: str,
    ) -> None:
        def process_update(request: Request, raw_body: bytes) -> bool:
            update = validate_model(UpdateEmbedding, orjson.loads(raw_body))

            # NOTE(rescrv, iron will auth):  v1
            self.sync_auth_and_get_tenant_and_database_for_request(
                request.headers,
                AuthzAction.UPDATE,
                None,
                None,
                collection_id,
            )

            return self._api._update(
                collection_id=_uuid(collection_id),
                ids=update.ids,
                embeddings=convert_list_embeddings_to_np(update.embeddings)
                if update.embeddings
                else None,
                metadatas=update.metadatas,  # type: ignore
                documents=update.documents,  # type: ignore
                uris=update.uris,  # type: ignore
            )

        await to_thread.run_sync(
            process_update,
            request,
            await request.body(),
            limiter=self._capacity_limiter,
        )

    @trace_method("FastAPI.upsert_v1", OpenTelemetryGranularity.OPERATION)
    @rate_limit
    async def upsert_v1(
        self,
        request: Request,
        collection_id: str,
    ) -> None:
        def process_upsert(request: Request, raw_body: bytes) -> bool:
            upsert = validate_model(AddEmbedding, orjson.loads(raw_body))

            # NOTE(rescrv, iron will auth):  v1
            self.sync_auth_and_get_tenant_and_database_for_request(
                request.headers,
                AuthzAction.UPSERT,
                None,
                None,
                collection_id,
            )

            return self._api._upsert(
                collection_id=_uuid(collection_id),
                ids=upsert.ids,
                embeddings=cast(
                    Embeddings,
                    convert_list_embeddings_to_np(upsert.embeddings)
                    if upsert.embeddings
                    else None,
                ),
                metadatas=upsert.metadatas,  # type: ignore
                documents=upsert.documents,  # type: ignore
                uris=upsert.uris,  # type: ignore
            )

        await to_thread.run_sync(
            process_upsert,
            request,
            await request.body(),
            limiter=self._capacity_limiter,
        )

    @trace_method("FastAPI.get_v1", OpenTelemetryGranularity.OPERATION)
    @rate_limit
    async def get_v1(
        self,
        collection_id: str,
        request: Request,
    ) -> GetResult:
        def process_get(request: Request, raw_body: bytes) -> GetResult:
            get = validate_model(GetEmbedding, orjson.loads(raw_body))
            # NOTE(rescrv, iron will auth):  v1
            self.sync_auth_and_get_tenant_and_database_for_request(
                request.headers,
                AuthzAction.GET,
                None,
                None,
                collection_id,
            )
            return self._api._get(
                collection_id=_uuid(collection_id),
                ids=get.ids,
                where=get.where,
                limit=get.limit,
                offset=get.offset,
                where_document=get.where_document,
                include=get.include,
            )

        get_result = cast(
            GetResult,
            await to_thread.run_sync(
                process_get,
                request,
                await request.body(),
                limiter=self._capacity_limiter,
            ),
        )

        if get_result["embeddings"] is not None:
            get_result["embeddings"] = [
                cast(Embedding, embedding).tolist()
                for embedding in get_result["embeddings"]
            ]

        return get_result

    @trace_method("FastAPI.delete_v1", OpenTelemetryGranularity.OPERATION)
    @rate_limit
    async def delete_v1(
        self,
        collection_id: str,
        request: Request,
    ) -> None:
        def process_delete(request: Request, raw_body: bytes) -> None:
            delete = validate_model(DeleteEmbedding, orjson.loads(raw_body))
            # NOTE(rescrv, iron will auth):  v1
            self.sync_auth_and_get_tenant_and_database_for_request(
                request.headers,
                AuthzAction.DELETE,
                None,
                None,
                collection_id,
            )
            return self._api._delete(
                collection_id=_uuid(collection_id),
                ids=delete.ids,
                where=delete.where,
                where_document=delete.where_document,
            )

        await to_thread.run_sync(
            process_delete,
            request,
            await request.body(),
            limiter=self._capacity_limiter,
        )

    @trace_method("FastAPI.count_v1", OpenTelemetryGranularity.OPERATION)
    @rate_limit
    async def count_v1(
        self,
        request: Request,
        collection_id: str,
    ) -> int:
        await self.auth_and_get_tenant_and_database_for_request(
            request.headers,
            AuthzAction.COUNT,
            None,
            None,
            collection_id,
        )

        return cast(
            int,
            await to_thread.run_sync(
                self._api._count,
                _uuid(collection_id),
                limiter=self._capacity_limiter,
            ),
        )

    @trace_method("FastAPI.reset_v1", OpenTelemetryGranularity.OPERATION)
    @rate_limit
    async def reset_v1(
        self,
        request: Request,
    ) -> bool:
        await self.auth_and_get_tenant_and_database_for_request(
            request.headers,
            AuthzAction.RESET,
            None,
            None,
            None,
        )

        return cast(
            bool,
            await to_thread.run_sync(
                self._api.reset,
                limiter=self._capacity_limiter,
            ),
        )

    @trace_method(
        "FastAPI.get_nearest_neighbors_v1", OpenTelemetryGranularity.OPERATION
    )
    @rate_limit
    async def get_nearest_neighbors_v1(
        self,
        collection_id: str,
        request: Request,
    ) -> QueryResult:
        def process_query(request: Request, raw_body: bytes) -> QueryResult:
            query = validate_model(QueryEmbedding, orjson.loads(raw_body))

            # NOTE(rescrv, iron will auth):  v1
            self.sync_auth_and_get_tenant_and_database_for_request(
                request.headers,
                AuthzAction.QUERY,
                None,
                None,
                collection_id,
            )

            return self._api._query(
                collection_id=_uuid(collection_id),
                query_embeddings=cast(
                    Embeddings,
                    convert_list_embeddings_to_np(query.query_embeddings)
                    if query.query_embeddings
                    else None,
                ),
                n_results=query.n_results,
                where=query.where,
                where_document=query.where_document,
                include=query.include,
            )

        nnresult = cast(
            QueryResult,
            await to_thread.run_sync(
                process_query,
                request,
                await request.body(),
                limiter=self._capacity_limiter,
            ),
        )

        if nnresult["embeddings"] is not None:
            nnresult["embeddings"] = [
                [cast(Embedding, embedding).tolist() for embedding in result]
                for result in nnresult["embeddings"]
            ]

        return nnresult

    # =========================================================================
