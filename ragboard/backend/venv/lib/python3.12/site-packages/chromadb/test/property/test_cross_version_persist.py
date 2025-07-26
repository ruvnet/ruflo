from multiprocessing.connection import Connection
import os
import shutil
import tempfile
from typing import Generator, List, Tuple, Dict, Any, Callable, Type
from hypothesis import given, settings
import hypothesis.strategies as st
import pytest
import json
from urllib import request
from chromadb import config
from chromadb.api.configuration import (
    ConfigurationParameter,
    EmbeddingsQueueConfigurationInternal,
)
from chromadb.api.types import Documents, EmbeddingFunction, Embeddings
from chromadb.db.impl.sqlite import SqliteDB
from chromadb.ingest.impl.utils import trigger_vector_segments_max_seq_id_migration
from chromadb.segment import SegmentManager
from chromadb.segment.impl.manager.local import LocalSegmentManager
import chromadb.test.property.strategies as strategies
import chromadb.test.property.invariants as invariants
from packaging import version as packaging_version
import re
import multiprocessing
from chromadb.config import Settings
from chromadb.api.client import Client as ClientCreator
from chromadb.test.utils.cross_version import (
    switch_to_version,
    install_version,
    get_path_to_version_install,
)

# Minimum persisted version we support, and other substantial change versions
# 0.4.1 is the first version with persistence
# 0.5.3 is the first version with the new API where the serverapi and client api return types and arguments differ
BASELINE_VERSIONS = ["0.4.1", "0.5.3"]
version_re = re.compile(r"^[0-9]+\.[0-9]+\.[0-9]+$")

# Some modules do not work across versions, since we upgrade our support for them, and should be explicitly reimported in the subprocess
VERSIONED_MODULES = ["pydantic", "numpy", "tokenizers"]


def versions() -> List[str]:
    """Returns the pinned minimum version and the latest version of chromadb."""
    url = "https://pypi.org/pypi/chromadb/json"
    data = json.load(request.urlopen(request.Request(url)))
    versions = list(data["releases"].keys())
    # Older versions on pypi contain "devXYZ" suffixes
    versions = [v for v in versions if version_re.match(v)]
    versions.sort(key=packaging_version.Version)
    return BASELINE_VERSIONS + [versions[-1]]


def _bool_to_int(metadata: Dict[str, Any]) -> Dict[str, Any]:
    metadata.update((k, 1) for k, v in metadata.items() if v is True)
    metadata.update((k, 0) for k, v in metadata.items() if v is False)
    return metadata


def _patch_boolean_metadata(
    collection: strategies.Collection,
    embeddings: strategies.RecordSet,
    settings: Settings,
) -> None:
    # Since the old version does not support boolean value metadata, we will convert
    # boolean value metadata to int
    collection_metadata = collection.metadata
    if collection_metadata is not None:
        _bool_to_int(collection_metadata)  # type: ignore

    if embeddings["metadatas"] is not None:
        if isinstance(embeddings["metadatas"], list):
            for metadata in embeddings["metadatas"]:
                if metadata is not None and isinstance(metadata, dict):
                    _bool_to_int(metadata)
        elif isinstance(embeddings["metadatas"], dict):
            metadata = embeddings["metadatas"]
            _bool_to_int(metadata)


def _patch_telemetry_client(
    collection: strategies.Collection,
    embeddings: strategies.RecordSet,
    settings: Settings,
) -> None:
    # chroma 0.4.14 added OpenTelemetry, distinct from ProductTelemetry. Before 0.4.14
    # ProductTelemetry was simply called Telemetry.
    settings.chroma_telemetry_impl = "chromadb.telemetry.posthog.Posthog"


version_patches: List[
    Tuple[str, Callable[[strategies.Collection, strategies.RecordSet, Settings], None]]
] = [
    ("0.4.3", _patch_boolean_metadata),
    ("0.4.14", _patch_telemetry_client),
]


def patch_for_version(
    version: str,
    collection: strategies.Collection,
    embeddings: strategies.RecordSet,
    settings: Settings,
) -> None:
    """Override aspects of the collection and embeddings, before testing, to account for
    breaking changes in old versions."""

    for patch_version, patch in version_patches:
        if packaging_version.Version(version) <= packaging_version.Version(
            patch_version
        ):
            patch(collection, embeddings, settings)


def api_import_for_version(module: Any, version: str) -> Type:  # type: ignore
    if packaging_version.Version(version) <= packaging_version.Version("0.4.14"):
        return module.api.API  # type: ignore
    return module.api.ServerAPI  # type: ignore


def configurations(versions: List[str]) -> List[Tuple[str, Settings]]:
    return [
        (
            version,
            Settings(
                chroma_api_impl="chromadb.api.rust.RustBindingsAPI"
                if "CHROMA_RUST_BINDINGS_TEST_ONLY" in os.environ
                else "chromadb.api.segment.SegmentAPI",
                chroma_sysdb_impl="chromadb.db.impl.sqlite.SqliteDB",
                chroma_producer_impl="chromadb.db.impl.sqlite.SqliteDB",
                chroma_consumer_impl="chromadb.db.impl.sqlite.SqliteDB",
                chroma_segment_manager_impl="chromadb.segment.impl.manager.local.LocalSegmentManager",
                allow_reset=True,
                is_persistent=True,
                persist_directory=tempfile.mkdtemp(),
            ),
        )
        for version in versions
    ]


test_old_versions = versions()
base_install_dir = tempfile.mkdtemp()


# This fixture is not shared with the rest of the tests because it is unique in how it
# installs the versions of chromadb
@pytest.fixture(scope="module", params=configurations(test_old_versions))  # type: ignore
def version_settings(request) -> Generator[Tuple[str, Settings], None, None]:
    configuration = request.param
    version = configuration[0]

    install_version(version, {})
    yield configuration
    # Cleanup the installed version
    path = get_path_to_version_install(version)
    shutil.rmtree(path)
    # Cleanup the persisted data
    data_path = configuration[1].persist_directory
    if os.path.exists(data_path):
        shutil.rmtree(data_path, ignore_errors=True)


class not_implemented_ef(EmbeddingFunction[Documents]):
    def __call__(self, input: Documents) -> Embeddings:
        assert False, "Embedding function should not be called"

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        pass


def persist_generated_data_with_old_version(
    version: str,
    settings: Settings,
    collection_strategy: strategies.Collection,
    embeddings_strategy: strategies.RecordSet,
    conn: Connection,
) -> None:
    try:
        old_module = switch_to_version(version, VERSIONED_MODULES)
        # In 0.7.0 we switch to Rust client. The old versions are using the the python SegmentAPI client
        if "CHROMA_RUST_BINDINGS_TEST_ONLY" in os.environ and packaging_version.Version(
            version
        ) < packaging_version.Version("0.7.0"):
            settings.chroma_api_impl = "chromadb.api.segment.SegmentAPI"
        system = old_module.config.System(settings)
        api = system.instance(api_import_for_version(old_module, version))
        system.start()

        api.reset()
        # In 0.5.4 we changed the API of the server api level to
        # deal with collection models instead of collections
        # in order to work with this we need to wrap the api in a client
        # for versions greater than or equal to 0.5.4
        if packaging_version.Version(version) >= packaging_version.Version("0.5.4"):
            api = old_module.api.client.Client.from_system(system)
        coll = api.create_collection(
            name=collection_strategy.name,
            metadata=collection_strategy.metadata,
            # In order to test old versions, we can't rely on the not_implemented function
            embedding_function=not_implemented_ef(),
        )
        coll.add(**embeddings_strategy)

        # Just use some basic checks for sanity and manual testing where you break the new
        # version

        check_embeddings = invariants.wrap_all(embeddings_strategy)
        # Check count
        assert coll.count() == len(check_embeddings["embeddings"] or [])
        # Check ids
        result = coll.get()
        actual_ids = result["ids"]
        embedding_id_to_index = {id: i for i, id in enumerate(check_embeddings["ids"])}
        actual_ids = sorted(actual_ids, key=lambda id: embedding_id_to_index[id])
        assert actual_ids == check_embeddings["ids"]

        # Leave writes on the queue to be processed by the next version's
        # segment manager so we can test cross version serialization
        # compatibility.
        system.instance(LocalSegmentManager).stop()
        coll.upsert(**embeddings_strategy)

        # Shutdown system
        system.stop()
    except Exception as e:
        conn.send(e)
        raise e


# Since we can't pickle the embedding function, we always generate record sets with embeddings
collection_st: st.SearchStrategy[strategies.Collection] = st.shared(
    strategies.collections(
        with_hnsw_params=True,
        has_embeddings=True,
        # By default, these are set to 2000, which makes it unlikely that index mutations will ever be fully flushed
        max_hnsw_sync_threshold=10,
        max_hnsw_batch_size=10,
        with_persistent_hnsw_params=st.booleans(),
    ),
    key="coll",
)


@given(
    collection_strategy=collection_st,
    embeddings_strategy=strategies.recordsets(collection_st, max_size=200),
)
@settings(deadline=None)
def test_cycle_versions(
    version_settings: Tuple[str, Settings],
    collection_strategy: strategies.Collection,
    embeddings_strategy: strategies.RecordSet,
) -> None:
    # Test backwards compatibility
    # For the current version, ensure that we can load a collection from
    # the previous versions
    version, settings = version_settings
    # The strategies can generate metadatas of malformed inputs. Other tests
    # will error check and cover these cases to make sure they error. Here we
    # just convert them to valid values since the error cases are already tested
    if embeddings_strategy["metadatas"] == {}:
        embeddings_strategy["metadatas"] = None
    if embeddings_strategy["metadatas"] is not None and isinstance(
        embeddings_strategy["metadatas"], list
    ):
        embeddings_strategy["metadatas"] = [
            m if m is None or len(m) > 0 else None
            for m in embeddings_strategy["metadatas"]
        ]

    patch_for_version(version, collection_strategy, embeddings_strategy, settings)

    # Can't pickle a function, and we won't need them
    collection_strategy.embedding_function = None
    collection_strategy.known_metadata_keys = {}

    # Run the task in a separate process to avoid polluting the current process
    # with the old version. Using spawn instead of fork to avoid sharing the
    # current process memory which would cause the old version to be loaded
    ctx = multiprocessing.get_context("spawn")
    conn1, conn2 = multiprocessing.Pipe()
    p = ctx.Process(
        target=persist_generated_data_with_old_version,
        args=(version, settings, collection_strategy, embeddings_strategy, conn2),
    )
    p.start()
    p.join()

    if conn1.poll():
        e = conn1.recv()
        raise e

    p.close()

    # Switch to the current version (local working directory) and check the invariants
    # are preserved for the collection
    system = config.System(settings)
    system.start()
    client = ClientCreator.from_system(system)
    coll = client.get_collection(
        name=collection_strategy.name,
        embedding_function=not_implemented_ef(),  # type: ignore
    )

    embeddings_queue = system.instance(SqliteDB)

    # Automatic pruning should be disabled since embeddings_queue is non-empty
    if packaging_version.Version(version) < packaging_version.Version(
        "0.5.7"
    ):  # (automatic pruning is enabled by default in 0.5.7 and later)
        assert (
            embeddings_queue.config.get_parameter("automatically_purge").value is False
        )

    # Update to True so log_size_below_max() invariant will pass
    embeddings_queue.set_config(
        EmbeddingsQueueConfigurationInternal(
            [ConfigurationParameter("automatically_purge", True)]
        )
    )

    # Should be able to clean log immediately after updating

    # 07/29/24: the max_seq_id for vector segments was moved from the pickled metadata file to SQLite.
    # Cleaning the log is dependent on vector segments migrating their max_seq_id from the pickled metadata file to SQLite.
    # Vector segments migrate this field automatically on init, but at this point the segment has not been loaded yet.
    if "CHROMA_RUST_BINDINGS_TEST_ONLY" in os.environ:
        # Trigger log purge in Rust impl
        invariants.count(coll, embeddings_strategy)
    else:
        trigger_vector_segments_max_seq_id_migration(
            embeddings_queue, system.instance(SegmentManager)
        )
        embeddings_queue.purge_log(coll.id)
    invariants.log_size_below_max(system, [coll], True)

    # Should be able to add embeddings
    coll.add(**embeddings_strategy)  # type: ignore

    invariants.count(coll, embeddings_strategy)
    invariants.metadatas_match(coll, embeddings_strategy)
    invariants.documents_match(coll, embeddings_strategy)
    invariants.ids_match(coll, embeddings_strategy)
    invariants.ann_accuracy(coll, embeddings_strategy)
    invariants.log_size_below_max(system, [coll], True)

    # Shutdown system
    system.stop()
