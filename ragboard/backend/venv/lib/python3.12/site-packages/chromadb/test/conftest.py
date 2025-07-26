import multiprocessing
import os
import socket
import subprocess
import tempfile
import time
from typing import (
    Any,
    Generator,
    Iterator,
    List,
    Optional,
    Sequence,
    Tuple,
    Callable,
    cast,
)
from uuid import UUID

import hypothesis
import pytest
import uvicorn
from httpx import ConnectError
from typing_extensions import Protocol

from chromadb.api.async_fastapi import AsyncFastAPI
from chromadb.api.fastapi import FastAPI
import chromadb.server.fastapi
from chromadb.api import ClientAPI, ServerAPI, BaseAPI
from chromadb.config import Settings, System
from chromadb.db.mixins import embeddings_queue
from chromadb.ingest import Producer
from chromadb.types import SeqId, OperationRecord
from chromadb.api.client import Client as ClientCreator, AdminClient
from chromadb.api.async_client import (
    AsyncAdminClient,
    AsyncClient as AsyncClientCreator,
)
from chromadb.utils.async_to_sync import async_class_to_sync
import logging
import sys
import numpy as np
from unittest.mock import MagicMock
from pytest import MonkeyPatch
from chromadb.api.types import Documents, Embeddings
import uuid

logger = logging.getLogger(__name__)

VALID_PRESETS = ["fast", "normal", "slow"]
CURRENT_PRESET = os.getenv("PROPERTY_TESTING_PRESET", "fast")

if CURRENT_PRESET not in VALID_PRESETS:
    raise ValueError(
        f"Invalid property testing preset: {CURRENT_PRESET}. Must be one of {VALID_PRESETS}."
    )

hypothesis.settings.register_profile(
    "base",
    deadline=90000,
    suppress_health_check=[
        hypothesis.HealthCheck.data_too_large,
        hypothesis.HealthCheck.large_base_example,
        hypothesis.HealthCheck.function_scoped_fixture,
    ],
    verbosity=hypothesis.Verbosity.verbose,
)

hypothesis.settings.register_profile(
    "fast", hypothesis.settings.get_profile("base"), max_examples=50
)
# Hypothesis's default max_examples is 100
hypothesis.settings.register_profile(
    "normal", hypothesis.settings.get_profile("base"), max_examples=100
)
hypothesis.settings.register_profile(
    "slow",
    hypothesis.settings.get_profile("base"),
    max_examples=500,
    stateful_step_count=100,
)

hypothesis.settings.load_profile(CURRENT_PRESET)


def reset(api: BaseAPI) -> None:
    api.reset()


def override_hypothesis_profile(
    fast: Optional[hypothesis.settings] = None,
    normal: Optional[hypothesis.settings] = None,
    slow: Optional[hypothesis.settings] = None,
) -> Optional[hypothesis.settings]:
    """Override Hypothesis settings for specific profiles.

    For example, to override max_examples only when the current profile is 'fast':

    override_hypothesis_profile(
        fast=hypothesis.settings(max_examples=50),
    )

    Settings will be merged with the default/active profile.
    """

    allowable_override_keys = [
        "deadline",
        "max_examples",
        "stateful_step_count",
        "suppress_health_check",
    ]

    override_profiles = {
        "fast": fast,
        "normal": normal,
        "slow": slow,
    }

    overriding_profile = override_profiles.get(CURRENT_PRESET)

    if overriding_profile is not None:
        overridden_settings = {
            key: value
            for key, value in overriding_profile.__dict__.items()
            if key in allowable_override_keys
        }

        return hypothesis.settings(hypothesis.settings.default, **overridden_settings)

    return cast(hypothesis.settings, hypothesis.settings.default)


NOT_CLUSTER_ONLY = os.getenv("CHROMA_CLUSTER_TEST_ONLY") != "1"
COMPACTION_SLEEP = 120


def skip_if_not_cluster() -> pytest.MarkDecorator:
    return pytest.mark.skipif(
        NOT_CLUSTER_ONLY,
        reason="Requires Kubernetes to be running with a valid config",
    )


def generate_self_signed_certificate() -> None:
    config_path = os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "openssl.cnf"
    )
    print(f"Config path: {config_path}")  # Debug print to verify path
    if not os.path.exists(config_path):
        raise FileNotFoundError(f"Config file not found at {config_path}")
    subprocess.run(
        [
            "openssl",
            "req",
            "-x509",
            "-newkey",
            "rsa:4096",
            "-keyout",
            "serverkey.pem",
            "-out",
            "servercert.pem",
            "-days",
            "365",
            "-nodes",
            "-subj",
            "/CN=localhost",
            "-config",
            config_path,
        ]
    )


def find_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("", 0))
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        return s.getsockname()[1]  # type: ignore


def _run_server(
    port: int,
    is_persistent: bool = False,
    persist_directory: Optional[str] = None,
    chroma_server_authn_provider: Optional[str] = None,
    chroma_server_authn_credentials_file: Optional[str] = None,
    chroma_server_authn_credentials: Optional[str] = None,
    chroma_auth_token_transport_header: Optional[str] = None,
    chroma_server_authz_provider: Optional[str] = None,
    chroma_server_authz_config_file: Optional[str] = None,
    chroma_server_ssl_certfile: Optional[str] = None,
    chroma_server_ssl_keyfile: Optional[str] = None,
    chroma_overwrite_singleton_tenant_database_access_from_auth: Optional[bool] = False,
) -> None:
    """Run a Chroma server locally"""
    if is_persistent and persist_directory:
        settings = Settings(
            chroma_api_impl="chromadb.api.segment.SegmentAPI",
            chroma_sysdb_impl="chromadb.db.impl.sqlite.SqliteDB",
            chroma_producer_impl="chromadb.db.impl.sqlite.SqliteDB",
            chroma_consumer_impl="chromadb.db.impl.sqlite.SqliteDB",
            chroma_segment_manager_impl="chromadb.segment.impl.manager.local.LocalSegmentManager",
            is_persistent=is_persistent,
            persist_directory=persist_directory,
            allow_reset=True,
            chroma_server_authn_provider=chroma_server_authn_provider,
            chroma_server_authn_credentials_file=chroma_server_authn_credentials_file,
            chroma_server_authn_credentials=chroma_server_authn_credentials,
            chroma_auth_token_transport_header=chroma_auth_token_transport_header,
            chroma_server_authz_provider=chroma_server_authz_provider,
            chroma_server_authz_config_file=chroma_server_authz_config_file,
            chroma_overwrite_singleton_tenant_database_access_from_auth=chroma_overwrite_singleton_tenant_database_access_from_auth,
        )
    else:
        settings = Settings(
            chroma_api_impl="chromadb.api.segment.SegmentAPI",
            chroma_sysdb_impl="chromadb.db.impl.sqlite.SqliteDB",
            chroma_producer_impl="chromadb.db.impl.sqlite.SqliteDB",
            chroma_consumer_impl="chromadb.db.impl.sqlite.SqliteDB",
            chroma_segment_manager_impl="chromadb.segment.impl.manager.local.LocalSegmentManager",
            is_persistent=False,
            allow_reset=True,
            chroma_server_authn_provider=chroma_server_authn_provider,
            chroma_server_authn_credentials_file=chroma_server_authn_credentials_file,
            chroma_server_authn_credentials=chroma_server_authn_credentials,
            chroma_auth_token_transport_header=chroma_auth_token_transport_header,
            chroma_server_authz_provider=chroma_server_authz_provider,
            chroma_server_authz_config_file=chroma_server_authz_config_file,
            chroma_overwrite_singleton_tenant_database_access_from_auth=chroma_overwrite_singleton_tenant_database_access_from_auth,
        )
    server = chromadb.server.fastapi.FastAPI(settings)
    uvicorn.run(
        server.app(),
        host="0.0.0.0",
        port=port,
        log_level="error",
        timeout_keep_alive=30,
        ssl_keyfile=chroma_server_ssl_keyfile,
        ssl_certfile=chroma_server_ssl_certfile,
    )


def _await_server(api: ServerAPI, attempts: int = 0) -> None:
    try:
        api.heartbeat()
    except ConnectError as e:
        if attempts > 15:
            raise e
        else:
            time.sleep(4)
            _await_server(api, attempts + 1)


def _fastapi_fixture(
    is_persistent: bool = False,
    chroma_api_impl: str = "chromadb.api.fastapi.FastAPI",
    chroma_server_authn_provider: Optional[str] = None,
    chroma_client_auth_provider: Optional[str] = None,
    chroma_server_authn_credentials_file: Optional[str] = None,
    chroma_server_authn_credentials: Optional[str] = None,
    chroma_client_auth_credentials: Optional[str] = None,
    chroma_auth_token_transport_header: Optional[str] = None,
    chroma_server_authz_provider: Optional[str] = None,
    chroma_server_authz_config_file: Optional[str] = None,
    chroma_server_ssl_certfile: Optional[str] = None,
    chroma_server_ssl_keyfile: Optional[str] = None,
    chroma_overwrite_singleton_tenant_database_access_from_auth: Optional[bool] = False,
) -> Generator[System, None, None]:
    """Fixture generator that launches a server in a separate process, and yields a
    fastapi client connect to it"""

    port = find_free_port()
    ctx = multiprocessing.get_context("spawn")
    args: Tuple[
        int,
        bool,
        Optional[str],
        Optional[str],
        Optional[str],
        Optional[str],
        Optional[str],
        Optional[str],
        Optional[str],
        Optional[str],
        Optional[str],
        Optional[bool],
    ] = (
        port,
        False,
        None,
        chroma_server_authn_provider,
        chroma_server_authn_credentials_file,
        chroma_server_authn_credentials,
        chroma_auth_token_transport_header,
        chroma_server_authz_provider,
        chroma_server_authz_config_file,
        chroma_server_ssl_certfile,
        chroma_server_ssl_keyfile,
        chroma_overwrite_singleton_tenant_database_access_from_auth,
    )

    def run(args: Any) -> Generator[System, None, None]:
        proc = ctx.Process(target=_run_server, args=args, daemon=True)
        proc.start()
        settings = Settings(
            chroma_api_impl=chroma_api_impl,
            chroma_server_host="localhost",
            chroma_server_http_port=port,
            allow_reset=True,
            chroma_client_auth_provider=chroma_client_auth_provider,
            chroma_client_auth_credentials=chroma_client_auth_credentials,
            chroma_auth_token_transport_header=chroma_auth_token_transport_header,
            chroma_server_ssl_verify=chroma_server_ssl_certfile,
            chroma_server_ssl_enabled=True if chroma_server_ssl_certfile else False,
            chroma_overwrite_singleton_tenant_database_access_from_auth=chroma_overwrite_singleton_tenant_database_access_from_auth,
        )
        system = System(settings)
        api = system.instance(ServerAPI)
        system.start()
        _await_server(api if isinstance(api, FastAPI) else async_class_to_sync(api))
        yield system
        system.stop()
        proc.kill()
        proc.join()

    if is_persistent:
        persist_directory = tempfile.TemporaryDirectory()
        args = (
            port,
            is_persistent,
            persist_directory.name,
            chroma_server_authn_provider,
            chroma_server_authn_credentials_file,
            chroma_server_authn_credentials,
            chroma_auth_token_transport_header,
            chroma_server_authz_provider,
            chroma_server_authz_config_file,
            chroma_server_ssl_certfile,
            chroma_server_ssl_keyfile,
            chroma_overwrite_singleton_tenant_database_access_from_auth,
        )

        yield from run(args)

        try:
            persist_directory.cleanup()

        # (Older versions of Python throw NotADirectoryError sometimes instead of PermissionError)
        # (when we drop support for Python < 3.10, we should use ignore_cleanup_errors=True with the context manager instead)
        except (PermissionError, NotADirectoryError) as e:
            # todo: what's holding onto directory contents on Windows?
            if os.name == "nt":
                pass
            else:
                raise e

    else:
        yield from run(args)


def fastapi() -> Generator[System, None, None]:
    return _fastapi_fixture(is_persistent=False)


def async_fastapi() -> Generator[System, None, None]:
    return _fastapi_fixture(
        is_persistent=False,
        chroma_api_impl="chromadb.api.async_fastapi.AsyncFastAPI",
    )


def fastapi_persistent() -> Generator[System, None, None]:
    return _fastapi_fixture(is_persistent=True)


def fastapi_ssl() -> Generator[System, None, None]:
    generate_self_signed_certificate()
    return _fastapi_fixture(
        is_persistent=False,
        chroma_server_ssl_certfile="./servercert.pem",
        chroma_server_ssl_keyfile="./serverkey.pem",
    )


@pytest.fixture()
def basic_http_client() -> Generator[System, None, None]:
    port = 8000
    host = "localhost"

    if os.getenv("CHROMA_SERVER_HOST"):
        host = os.getenv("CHROMA_SERVER_HOST", "").split(":")[0]
        port = int(os.getenv("CHROMA_SERVER_HOST", "").split(":")[1])

    settings = Settings(
        chroma_api_impl="chromadb.api.fastapi.FastAPI",
        chroma_server_http_port=port,
        chroma_server_host=host,
        allow_reset=True,
    )
    system = System(settings)
    api = system.instance(ServerAPI)
    _await_server(api)
    system.start()
    yield system
    system.stop()


def fastapi_server_basic_auth_valid_cred_single_user() -> Generator[System, None, None]:
    # This (and similar usage below) should use the delete_on_close parameter
    # instead of delete=False, but it's only available in Python 3.12 and later.
    # We must explicitly close the file before spawning a subprocess to avoid
    # file locking issues on Windows.
    with tempfile.NamedTemporaryFile("w", suffix=".htpasswd", delete=False) as f:
        f.write("admin:$2y$05$e5sRb6NCcSH3YfbIxe1AGu2h5K7OOd982OXKmd8WyQ3DRQ4MvpnZS\n")
        f.close()

        for item in _fastapi_fixture(
            is_persistent=False,
            chroma_server_authn_provider="chromadb.auth.basic_authn.BasicAuthenticationServerProvider",
            chroma_server_authn_credentials_file=f.name,
            chroma_client_auth_provider="chromadb.auth.basic_authn.BasicAuthClientProvider",
            chroma_client_auth_credentials="admin:admin",
        ):
            yield item


def fastapi_server_basic_auth_valid_cred_multiple_users() -> (
    Generator[System, None, None]
):
    creds = {
        "user": "$2y$10$kY9hn.Wlfcj7n1Cnjmy1kuIhEFIVBsfbNWLQ5ahoKmdc2HLA4oP6i",
        "user2": "$2y$10$CymQ63tic/DRj8dD82915eoM4ke3d6RaNKU4dj4IVJlHyea0yeGDS",
        "admin": "$2y$05$e5sRb6NCcSH3YfbIxe1AGu2h5K7OOd982OXKmd8WyQ3DRQ4MvpnZS",
    }
    with tempfile.NamedTemporaryFile("w", suffix=".htpasswd", delete=False) as f:
        for user, cred in creds.items():
            f.write(f"{user}:{cred}\n")
        f.close()

        for item in _fastapi_fixture(
            is_persistent=False,
            chroma_server_authn_provider="chromadb.auth.basic_authn.BasicAuthenticationServerProvider",
            chroma_server_authn_credentials_file=f.name,
            chroma_client_auth_provider="chromadb.auth.basic_authn.BasicAuthClientProvider",
            chroma_client_auth_credentials="admin:admin",
        ):
            yield item


def fastapi_server_basic_auth_invalid_cred() -> Generator[System, None, None]:
    with tempfile.NamedTemporaryFile("w", suffix=".htpasswd", delete=False) as f:
        f.write("admin:$2y$05$e5sRb6NCcSH3YfbIxe1AGu2h5K7OOd982OXKmd8WyQ3DRQ4MvpnZS\n")
        f.close()

        for item in _fastapi_fixture(
            is_persistent=False,
            chroma_server_authn_provider="chromadb.auth.basic_authn.BasicAuthenticationServerProvider",
            chroma_server_authn_credentials_file=f.name,
            chroma_client_auth_provider="chromadb.auth.basic_authn.BasicAuthClientProvider",
            chroma_client_auth_credentials="admin:admin1",
        ):
            yield item


def fastapi_server_basic_authn_rbac_authz() -> Generator[System, None, None]:
    with tempfile.NamedTemporaryFile(
        "w", suffix=".htpasswd", delete=False
    ) as server_authn_file:
        server_authn_file.write(
            "admin:$2y$05$e5sRb6NCcSH3YfbIxe1AGu2h5K7OOd982OXKmd8WyQ3DRQ4MvpnZS\n"
        )
        server_authn_file.close()

        with tempfile.NamedTemporaryFile(
            "w", suffix=".authz", delete=False
        ) as server_authz_file:
            server_authz_file.write(
                """
roles_mapping:
    admin:
        actions:
            [
                "system:reset",
                "tenant:create_tenant",
                "tenant:get_tenant",
                "db:create_database",
                "db:get_database",
                "db:list_collections",
                "db:create_collection",
                "db:get_or_create_collection",
                "collection:get_collection",
                "collection:delete_collection",
                "collection:update_collection",
                "collection:add",
                "collection:delete",
                "collection:get",
                "collection:query",
                "collection:peek",
                "collection:update",
                "collection:upsert",
                "collection:count",
            ]
users:
- id: admin
  role: admin
    """
            )
            server_authz_file.close()

            for item in _fastapi_fixture(
                is_persistent=False,
                chroma_client_auth_provider="chromadb.auth.basic_authn.BasicAuthClientProvider",
                chroma_client_auth_credentials="admin:admin",
                chroma_server_authn_provider="chromadb.auth.basic_authn.BasicAuthenticationServerProvider",
                chroma_server_authn_credentials_file=server_authn_file.name,
                chroma_server_authz_provider="chromadb.auth.simple_rbac_authz.SimpleRBACAuthorizationProvider",
                chroma_server_authz_config_file=server_authz_file.name,
            ):
                yield item


def fastapi_fixture_admin_and_singleton_tenant_db_user() -> (
    Generator[System, None, None]
):
    with tempfile.NamedTemporaryFile("w", suffix=".authn", delete=False) as f:
        f.write(
            """
users:
  - id: admin
    tokens:
      - admin-token
  - id: singleton_user
    tenant: singleton_tenant
    databases:
      - singleton_database
    tokens:
      - singleton-token
"""
        )
        f.close()

        for item in _fastapi_fixture(
            is_persistent=False,
            chroma_overwrite_singleton_tenant_database_access_from_auth=True,
            chroma_client_auth_provider="chromadb.auth.token_authn.TokenAuthClientProvider",
            chroma_client_auth_credentials="admin-token",
            chroma_server_authn_provider="chromadb.auth.token_authn.TokenAuthenticationServerProvider",
            chroma_server_authn_credentials_file=f.name,
        ):
            yield item


@pytest.fixture()
def integration() -> Generator[System, None, None]:
    """Fixture generator for returning a client configured via environmenet
    variables, intended for externally configured integration tests
    """
    settings = Settings(
        allow_reset=True, chroma_api_impl="chromadb.api.fastapi.FastAPI"
    )
    system = System(settings)
    system.start()
    yield system
    system.stop()


@pytest.fixture()
def async_integration() -> Generator[System, None, None]:
    """Fixture generator for returning a client configured via environmenet
    variables, intended for externally configured integration tests
    """
    settings = Settings(
        allow_reset=True, chroma_api_impl="chromadb.api.async_fastapi.AsyncFastAPI"
    )
    system = System(settings)
    system.start()
    yield system
    system.stop()


@pytest.fixture(scope="function")
def python_sqlite_ephemeral() -> Generator[System, None, None]:
    """Fixture generator for segment-based API using in-memory Sqlite"""
    settings = Settings(
        chroma_api_impl="chromadb.api.segment.SegmentAPI",
        chroma_sysdb_impl="chromadb.db.impl.sqlite.SqliteDB",
        chroma_producer_impl="chromadb.db.impl.sqlite.SqliteDB",
        chroma_consumer_impl="chromadb.db.impl.sqlite.SqliteDB",
        chroma_segment_manager_impl="chromadb.segment.impl.manager.local.LocalSegmentManager",
        is_persistent=False,
        allow_reset=True,
    )
    system = System(settings)
    system.start()
    yield system
    system.stop()


@pytest.fixture(scope="function")
def python_sqlite_persistent() -> Generator[System, None, None]:
    """Fixture generator for segment-based API using persistent Sqlite"""
    save_path = tempfile.TemporaryDirectory()
    settings = Settings(
        chroma_api_impl="chromadb.api.segment.SegmentAPI",
        chroma_sysdb_impl="chromadb.db.impl.sqlite.SqliteDB",
        chroma_producer_impl="chromadb.db.impl.sqlite.SqliteDB",
        chroma_consumer_impl="chromadb.db.impl.sqlite.SqliteDB",
        chroma_segment_manager_impl="chromadb.segment.impl.manager.local.LocalSegmentManager",
        allow_reset=True,
        is_persistent=True,
        persist_directory=save_path.name,
    )
    system = System(settings)
    system.start()
    yield system
    system.stop()

    try:
        save_path.cleanup()

    # (Older versions of Python throw NotADirectoryError sometimes instead of PermissionError)
    # (when we drop support for Python < 3.10, we should use ignore_cleanup_errors=True with the context manager instead)
    except (PermissionError, NotADirectoryError) as e:
        # todo: what's holding onto directory contents on Windows?
        if os.name == "nt":
            pass
        else:
            raise e


@pytest.fixture(scope="function")
def rust_sqlite_ephemeral() -> Generator[System, None, None]:
    """Fixture generator for system using ephemeral Rust bindings"""
    settings = Settings(
        chroma_api_impl="chromadb.api.rust.RustBindingsAPI",
        chroma_sysdb_impl="chromadb.db.impl.sqlite.SqliteDB",
        chroma_producer_impl="chromadb.db.impl.sqlite.SqliteDB",
        chroma_consumer_impl="chromadb.db.impl.sqlite.SqliteDB",
        chroma_segment_manager_impl="chromadb.segment.impl.manager.local.LocalSegmentManager",
        is_persistent=False,
        allow_reset=True,
        persist_directory="",
    )
    system = System(settings)
    system.start()
    yield system
    system.stop()


@pytest.fixture(scope="function")
def rust_sqlite_persistent() -> Generator[System, None, None]:
    """Fixture generator for system using Rust bindings"""
    save_path = tempfile.TemporaryDirectory()
    settings = Settings(
        chroma_api_impl="chromadb.api.rust.RustBindingsAPI",
        chroma_sysdb_impl="chromadb.db.impl.sqlite.SqliteDB",
        chroma_producer_impl="chromadb.db.impl.sqlite.SqliteDB",
        chroma_consumer_impl="chromadb.db.impl.sqlite.SqliteDB",
        chroma_segment_manager_impl="chromadb.segment.impl.manager.local.LocalSegmentManager",
        is_persistent=True,
        allow_reset=True,
        persist_directory=save_path.name,
    )
    system = System(settings)
    system.start()
    yield system
    system.stop()


@pytest.fixture(
    params=["rust_sqlite_ephemeral"]
    if "CHROMA_RUST_BINDINGS_TEST_ONLY" in os.environ
    else ["python_sqlite_ephemeral"]
)
def sqlite(request: pytest.FixtureRequest) -> Generator[System, None, None]:
    return request.getfixturevalue(request.param)


@pytest.fixture(
    params=["rust_sqlite_persistent"]
    if "CHROMA_RUST_BINDINGS_TEST_ONLY" in os.environ
    else ["python_sqlite_persistent"]
)
def sqlite_persistent(request: pytest.FixtureRequest) -> Generator[System, None, None]:
    return request.getfixturevalue(request.param)


def filtered_fixture_names() -> List[str]:
    fixtures = [
        "fastapi",
        "async_fastapi",
        "fastapi_persistent",
        "sqlite_fixture",
        "sqlite_persistent",
    ]

    if "CHROMA_INTEGRATION_TEST" in os.environ:
        fixtures.append("integration")
        fixtures.append("async_integration")
    if "CHROMA_INTEGRATION_TEST_ONLY" in os.environ:
        fixtures = ["integration", "async_integration"]
    if "CHROMA_CLUSTER_TEST_ONLY" in os.environ:
        fixtures = ["basic_http_client"]
    if "CHROMA_RUST_BINDINGS_TEST_ONLY" in os.environ:
        fixtures = ["rust_sqlite_ephemeral", "rust_sqlite_persistent"]
    return fixtures


def filtered_http_server_fixture_names() -> List[str]:
    fixtures = [
        fixture
        for fixture in filtered_fixture_names()
        if fixture
        not in [
            "python_sqlite_ephemeral",
            "python_sqlite_persistent",
            "rust_sqlite_ephemeral",
            "rust_sqlite_persistent",
        ]
    ]
    return fixtures


def system_fixtures_auth() -> List[Callable[[], Generator[System, None, None]]]:
    fixtures = [
        fastapi_server_basic_auth_valid_cred_single_user,
        fastapi_server_basic_auth_valid_cred_multiple_users,
    ]
    return fixtures


def system_fixtures_authn_rbac_authz() -> (
    List[Callable[[], Generator[System, None, None]]]
):
    fixtures = [fastapi_server_basic_authn_rbac_authz]
    return fixtures


def system_fixtures_root_and_singleton_tenant_db_user() -> (
    List[Callable[[], Generator[System, None, None]]]
):
    fixtures = [fastapi_fixture_admin_and_singleton_tenant_db_user]
    return fixtures


def system_fixtures_wrong_auth() -> List[Callable[[], Generator[System, None, None]]]:
    fixtures = [fastapi_server_basic_auth_invalid_cred]
    return fixtures


def system_fixtures_ssl() -> List[Callable[[], Generator[System, None, None]]]:
    fixtures = [fastapi_ssl]
    return fixtures


@pytest.fixture(scope="module", params=system_fixtures_wrong_auth())
def system_wrong_auth(
    request: pytest.FixtureRequest,
) -> Generator[ServerAPI, None, None]:
    yield from request.param()


@pytest.fixture(scope="module", params=system_fixtures_authn_rbac_authz())
def system_authn_rbac_authz(
    request: pytest.FixtureRequest,
) -> Generator[ServerAPI, None, None]:
    yield from request.param()


@pytest.fixture(params=filtered_http_server_fixture_names())
def system_http_server(
    request: pytest.FixtureRequest,
) -> Generator[ServerAPI, None, None]:
    return request.getfixturevalue(request.param)


@pytest.fixture(scope="function", params=filtered_fixture_names())
def system(request: pytest.FixtureRequest) -> Generator[ServerAPI, None, None]:
    return request.getfixturevalue(request.param)


@pytest.fixture(scope="module", params=system_fixtures_ssl())
def system_ssl(request: pytest.FixtureRequest) -> Generator[ServerAPI, None, None]:
    yield from request.param()


@pytest.fixture(scope="module", params=system_fixtures_auth())
def system_auth(request: pytest.FixtureRequest) -> Generator[ServerAPI, None, None]:
    yield from request.param()


@async_class_to_sync
class AsyncClientCreatorSync(AsyncClientCreator):
    pass


@async_class_to_sync
class AsyncAdminClientSync(AsyncAdminClient):
    pass


@pytest.fixture(scope="function")
def api(system: System) -> Generator[ServerAPI, None, None]:
    system.reset_state()
    api = system.instance(ServerAPI)

    if isinstance(api, AsyncFastAPI):
        transformed = async_class_to_sync(api)
        yield transformed
    else:
        yield api


class ClientFactories:
    """This allows consuming tests to be parameterized by async/sync versions of the client and papers over the async implementation.
    If you don't need to manually construct clients, use the `client` fixture instead.
    """

    _system: System
    # Need to track created clients so we can call .clear_system_cache() during teardown
    _created_clients: List[ClientAPI] = []

    def __init__(self, system: System):
        self._system = system

    def create_client(self, *args: Any, **kwargs: Any) -> ClientCreator:
        if kwargs.get("settings") is None:
            kwargs["settings"] = self._system.settings

        if (
            self._system.settings.chroma_api_impl
            == "chromadb.api.async_fastapi.AsyncFastAPI"
        ):
            client = cast(ClientCreator, AsyncClientCreatorSync.create(*args, **kwargs))
            self._created_clients.append(client)
            return client

        client = ClientCreator(*args, **kwargs)
        self._created_clients.append(client)
        return client

    def create_client_from_system(self) -> ClientCreator:
        if (
            self._system.settings.chroma_api_impl
            == "chromadb.api.async_fastapi.AsyncFastAPI"
        ):
            client = cast(
                ClientCreator, AsyncClientCreatorSync.from_system_async(self._system)
            )
            self._created_clients.append(client)
            return client

        client = ClientCreator.from_system(self._system)
        self._created_clients.append(client)
        return client

    def create_admin_client(self, *args: Any, **kwargs: Any) -> AdminClient:
        if (
            self._system.settings.chroma_api_impl
            == "chromadb.api.async_fastapi.AsyncFastAPI"
        ):
            client = cast(AdminClient, AsyncAdminClientSync(*args, **kwargs))
            self._created_clients.append(client)
            return client

        client = AdminClient(*args, **kwargs)
        self._created_clients.append(client)
        return client

    def create_admin_client_from_system(self) -> AdminClient:
        if (
            self._system.settings.chroma_api_impl
            == "chromadb.api.async_fastapi.AsyncFastAPI"
        ):
            client = cast(AdminClient, AsyncAdminClientSync.from_system(self._system))
            self._created_clients.append(client)
            return client

        client = AdminClient.from_system(self._system)
        self._created_clients.append(client)
        return client


@pytest.fixture(scope="function")
def client_factories(system: System) -> Generator[ClientFactories, None, None]:
    system.reset_state()

    factories = ClientFactories(system)
    yield factories

    while len(factories._created_clients) > 0:
        client = factories._created_clients.pop()
        client.clear_system_cache()
        del client


def create_isolated_database(client: ClientAPI) -> None:
    """Create an isolated database for a test and updates the client to use it."""
    admin_settings = client.get_settings()
    if admin_settings.chroma_api_impl == "chromadb.api.async_fastapi.AsyncFastAPI":
        admin_settings.chroma_api_impl = "chromadb.api.fastapi.FastAPI"

    admin = AdminClient(admin_settings)
    database = "test_" + str(uuid.uuid4())
    admin.create_database(database)
    client.set_database(database)


@pytest.fixture(scope="function")
def client(system: System) -> Generator[ClientAPI, None, None]:
    system.reset_state()

    if system.settings.chroma_api_impl == "chromadb.api.async_fastapi.AsyncFastAPI":
        client = cast(Any, AsyncClientCreatorSync.from_system_async(system))
        yield client
        client.clear_system_cache()
    else:
        client = ClientCreator.from_system(system)
        yield client
        client.clear_system_cache()


@pytest.fixture(scope="function")
def http_client(system_http_server: System) -> Generator[ClientAPI, None, None]:
    system_http_server.reset_state()

    if (
        system_http_server.settings.chroma_api_impl
        == "chromadb.api.async_fastapi.AsyncFastAPI"
    ):
        client = cast(Any, AsyncClientCreatorSync.from_system_async(system_http_server))
        yield client
        client.clear_system_cache()
    else:
        client = ClientCreator.from_system(system_http_server)
        yield client
        client.clear_system_cache()


@pytest.fixture(scope="function")
def client_ssl(system_ssl: System) -> Generator[ClientAPI, None, None]:
    system_ssl.reset_state()
    client = ClientCreator.from_system(system_ssl)
    yield client
    client.clear_system_cache()


@pytest.fixture(scope="function")
def api_wrong_cred(
    system_wrong_auth: System,
) -> Generator[ServerAPI, None, None]:
    system_wrong_auth.reset_state()
    api = system_wrong_auth.instance(ServerAPI)
    yield api


@pytest.fixture(scope="function")
def api_with_authn_rbac_authz(
    system_authn_rbac_authz: System,
) -> Generator[ServerAPI, None, None]:
    system_authn_rbac_authz.reset_state()
    api = system_authn_rbac_authz.instance(ServerAPI)
    yield api


@pytest.fixture(scope="function")
def api_with_server_auth(system_auth: System) -> Generator[ServerAPI, None, None]:
    _sys = system_auth
    _sys.reset_state()
    api = _sys.instance(ServerAPI)
    yield api


# Producer / Consumer fixtures #


class ProducerFn(Protocol):
    def __call__(
        self,
        producer: Producer,
        collection_id: UUID,
        embeddings: Iterator[OperationRecord],
        n: int,
    ) -> Tuple[Sequence[OperationRecord], Sequence[SeqId]]:
        ...


def produce_n_single(
    producer: Producer,
    collection_id: UUID,
    embeddings: Iterator[OperationRecord],
    n: int,
) -> Tuple[Sequence[OperationRecord], Sequence[SeqId]]:
    submitted_embeddings = []
    seq_ids = []
    for _ in range(n):
        e = next(embeddings)
        seq_id = producer.submit_embedding(collection_id, e)
        submitted_embeddings.append(e)
        seq_ids.append(seq_id)
    return submitted_embeddings, seq_ids


def produce_n_batch(
    producer: Producer,
    collection_id: UUID,
    embeddings: Iterator[OperationRecord],
    n: int,
) -> Tuple[Sequence[OperationRecord], Sequence[SeqId]]:
    submitted_embeddings = []
    seq_ids: Sequence[SeqId] = []
    for _ in range(n):
        e = next(embeddings)
        submitted_embeddings.append(e)
    seq_ids = producer.submit_embeddings(collection_id, submitted_embeddings)
    return submitted_embeddings, seq_ids


def produce_fn_fixtures() -> List[ProducerFn]:
    return [produce_n_single, produce_n_batch]


@pytest.fixture(scope="module", params=produce_fn_fixtures())
def produce_fns(
    request: pytest.FixtureRequest,
) -> Generator[ProducerFn, None, None]:
    yield request.param


def pytest_configure(config):  # type: ignore
    embeddings_queue._called_from_test = True


def is_client_in_process(client: ClientAPI) -> bool:
    """Returns True if the client is in-process (a SQLite client), False if it's out-of-process (a HTTP client)."""
    return client.get_settings().chroma_server_http_port is None


@pytest.fixture(autouse=True)
def log_tests(request: pytest.FixtureRequest) -> Generator[None, None, None]:
    """Automatically logs the start and end of each test."""
    test_name = request.node.name
    logger.debug(f"Starting test: {test_name}")

    # Yield control back to the test, allowing it to execute
    yield

    logger.debug(f"Finished test: {test_name}")


@pytest.fixture
def mock_embeddings() -> Callable[[Documents], Embeddings]:
    """Return mock embeddings for testing"""

    def _mock_embeddings(input: Documents) -> Embeddings:
        return [np.array([0.1, 0.2, 0.3], dtype=np.float32) for _ in input]

    return _mock_embeddings


@pytest.fixture
def mock_common_deps(monkeypatch: MonkeyPatch) -> MonkeyPatch:
    """Mock common dependencies"""
    # Create mock modules
    mock_modules = {
        "PIL": MagicMock(),
        "torch": MagicMock(),
        "openai": MagicMock(),
        "cohere": MagicMock(),
        "sentence_transformers": MagicMock(),
        "ollama": MagicMock(),
        "InstructorEmbedding": MagicMock(),
        "voyageai": MagicMock(),
        "text2vec": MagicMock(),
        "open_clip": MagicMock(),
        "boto3": MagicMock(),
    }

    # Mock all modules at once using monkeypatch.setitem
    monkeypatch.setattr(sys, "modules", dict(sys.modules, **mock_modules))

    # Mock submodules and attributes
    mock_attributes = {
        "PIL.Image": MagicMock(),
        "sentence_transformers.SentenceTransformer": MagicMock(),
        "ollama.Client": MagicMock(),
        "InstructorEmbedding.INSTRUCTOR": MagicMock(),
        "voyageai.Client": MagicMock(),
        "text2vec.SentenceModel": MagicMock(),
    }

    # Setup OpenCLIP mock with specific behavior
    mock_model = MagicMock()
    mock_model.encode_text.return_value = np.array([[0.1, 0.2, 0.3]])
    mock_model.encode_image.return_value = np.array([[0.1, 0.2, 0.3]])
    mock_modules["open_clip"].create_model_and_transforms.return_value = (
        mock_model,
        MagicMock(),
        mock_model,
    )

    # Mock all attributes
    for path, mock in mock_attributes.items():
        monkeypatch.setattr(path, mock, raising=False)

    return monkeypatch
