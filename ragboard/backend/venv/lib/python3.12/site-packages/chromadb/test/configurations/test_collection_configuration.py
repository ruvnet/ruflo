import pytest
from typing import Dict, Any, cast, List
import numpy as np
from chromadb.api.types import (
    EmbeddingFunction,
    Embeddings,
    Space,
    Embeddable,
)
from chromadb.api import ClientAPI
from chromadb.api.collection_configuration import (
    CreateCollectionConfiguration,
    UpdateCollectionConfiguration,
    load_collection_configuration_from_json,
    CreateHNSWConfiguration,
    UpdateHNSWConfiguration,
    CreateSpannConfiguration,
    UpdateSpannConfiguration,
    SpannConfiguration,
    overwrite_spann_configuration,
)
import json
import os
from chromadb.utils.embedding_functions import register_embedding_function
from chromadb.test.conftest import ClientFactories
from chromadb.types import Collection as CollectionModel


# Check if we are running in a mode where SPANN is disabled
# (Rust bindings test OR Rust single-node integration test)
is_spann_disabled_mode = (
    os.getenv("CHROMA_RUST_BINDINGS_TEST_ONLY") == "1"
    or os.getenv("CHROMA_INTEGRATION_TEST_ONLY") == "1"
)
skip_reason_spann_disabled = (
    "SPANN creation/modification disallowed in Rust bindings or integration test mode"
)


class LegacyEmbeddingFunction(EmbeddingFunction[Embeddable]):
    def __init__(self) -> None:
        pass

    def __call__(self, input: Embeddable) -> Embeddings:
        return cast(Embeddings, np.array([[1.0, 2.0]], dtype=np.float32))


class LegacyEmbeddingFunctionWithName(EmbeddingFunction[Embeddable]):
    def __init__(self) -> None:
        pass

    def __call__(self, input: Embeddable) -> Embeddings:
        return cast(Embeddings, np.array([[1.0, 2.0]], dtype=np.float32))

    @staticmethod
    def name() -> str:
        return "legacy_ef"


@register_embedding_function
class CustomEmbeddingFunction(EmbeddingFunction[Embeddable]):
    def __init__(self, dim: int = 3):
        self._dim = dim

    def __call__(self, input: Embeddable) -> Embeddings:
        return cast(Embeddings, np.array([[1.0] * self._dim], dtype=np.float32))

    @staticmethod
    def name() -> str:
        return "custom_ef"

    def get_config(self) -> Dict[str, Any]:
        return {"dim": self._dim}

    @staticmethod
    def build_from_config(config: Dict[str, Any]) -> "CustomEmbeddingFunction":
        return CustomEmbeddingFunction(dim=config["dim"])

    def default_space(self) -> Space:
        return "cosine"


@register_embedding_function
class CustomEmbeddingFunction2(EmbeddingFunction[Embeddable]):
    def __init__(self, dim: int = 4):
        self._dim = dim

    def __call__(self, input: Embeddable) -> Embeddings:
        return cast(Embeddings, np.array([[2.0] * self._dim], dtype=np.float32))

    @staticmethod
    def name() -> str:
        return "custom_ef2"

    def get_config(self) -> Dict[str, Any]:
        return {"dim": self._dim}

    @staticmethod
    def build_from_config(config: Dict[str, Any]) -> "CustomEmbeddingFunction2":
        return CustomEmbeddingFunction2(dim=config["dim"])

    def default_space(self) -> Space:
        return "l2"


def test_legacy_embedding_function(client: ClientAPI) -> None:
    """Test creating and getting collections with legacy embedding functions"""
    client.reset()

    # Create with legacy embedding function
    coll = client.create_collection(
        name="test_legacy",
        embedding_function=LegacyEmbeddingFunction(),
    )

    # Verify the configuration marks it as legacy
    config = load_collection_configuration_from_json(coll._model.configuration_json)
    if config and isinstance(config, dict):
        ef = config.get("embedding_function")
        assert ef is None  # legacy embedding functions return as None
    else:
        assert False, f"config: {config}"

    # Get with same legacy function
    coll2 = client.get_collection(
        name="test_legacy",
        embedding_function=LegacyEmbeddingFunction(),
    )

    # Add and query should work
    coll2.add(ids=["1"], documents=["test"])
    results = coll2.query(query_texts=["test"], n_results=1)
    assert len(results["ids"]) == 1


def test_legacy_embedding_function_with_name(client: ClientAPI) -> None:
    """Test creating and getting collections with legacy embedding functions"""
    client.reset()

    # Create with legacy embedding function
    coll = client.create_collection(
        name="test_legacy",
        embedding_function=LegacyEmbeddingFunctionWithName(),
    )

    # Verify the configuration marks it as legacy
    config = load_collection_configuration_from_json(coll._model.configuration_json)
    if config and isinstance(config, dict):
        ef = config.get("embedding_function")
        assert ef is None  # legacy embedding functions return as None
    else:
        assert False, f"config: {config}"

    # Get with same legacy function
    coll2 = client.get_collection(
        name="test_legacy",
        embedding_function=LegacyEmbeddingFunctionWithName(),
    )

    # Add and query should work
    coll2.add(ids=["1"], documents=["test"])
    results = coll2.query(query_texts=["test"], n_results=1)
    assert len(results["ids"]) == 1


def test_legacy_metadata(client: ClientAPI) -> None:
    """Test creating collections with legacy metadata format"""
    client.reset()

    # Create with legacy metadata
    legacy_metadata = {
        "hnsw:space": "cosine",
        "hnsw:construction_ef": 200,
        "hnsw:M": 10,  # This is the legacy name for max_neighbors
    }
    coll = client.create_collection(
        name="test_legacy_metadata",
        metadata=legacy_metadata,
    )

    # Verify the configuration contains the legacy settings
    config = load_collection_configuration_from_json(coll._model.configuration_json)
    if config and isinstance(config, dict):
        hnsw_config = cast(CreateHNSWConfiguration, config.get("hnsw", {}))
        assert str(hnsw_config.get("space")) == str("cosine")
        assert hnsw_config.get("ef_construction") == 200
        assert hnsw_config.get("max_neighbors") == 10
        assert hnsw_config.get("ef_search") == 100

        ef = config.get("embedding_function")
        assert ef is not None
        assert ef.name() == "default"


def test_new_configuration(client: ClientAPI) -> None:
    """Test creating collections with new configuration format"""
    client.reset()

    # Create with new configuration
    hnsw_config: CreateHNSWConfiguration = {
        "space": "cosine",  # Use enum value
        "ef_construction": 100,
        "max_neighbors": 10,  # Changed from M to max_neighbors
        "ef_search": 20,
        "num_threads": 2,
    }
    config: CreateCollectionConfiguration = {
        "hnsw": hnsw_config,
        "embedding_function": CustomEmbeddingFunction(dim=5),
    }

    coll = client.create_collection(
        name="test_new_config",
        configuration=config,
    )

    # Verify configuration is preserved
    loaded_config = load_collection_configuration_from_json(
        coll._model.configuration_json
    )
    if loaded_config and isinstance(loaded_config, dict):
        hnsw_config = cast(CreateHNSWConfiguration, loaded_config.get("hnsw", {}))
        ef = loaded_config.get("embedding_function", {})  # type: ignore
        assert hnsw_config.get("space") == "cosine"
        assert hnsw_config.get("ef_construction") == 100
        assert hnsw_config.get("max_neighbors") == 10
        assert ef is not None


def test_invalid_configurations(client: ClientAPI) -> None:
    """Test validation of invalid configurations"""
    client.reset()

    # Test invalid HNSW parameters
    with pytest.raises(Exception) as excinfo:
        invalid_hnsw: CreateHNSWConfiguration = {
            "ef_construction": -1,
            "space": "cosine",
        }
        client.create_collection(
            name="test_invalid",
            configuration={"hnsw": invalid_hnsw},
        )

        assert "invalid value" in str(excinfo.value)


def test_hnsw_configuration_updates(client: ClientAPI) -> None:
    """Test updating collection configurations"""
    client.reset()

    # Create initial collection
    initial_hnsw: CreateHNSWConfiguration = {
        "ef_search": 10,
        "num_threads": 1,
        "space": "cosine",
    }
    coll = client.create_collection(
        name="test_updates",
        configuration={"hnsw": initial_hnsw},
    )

    # Update configuration
    update_hnsw: UpdateHNSWConfiguration = {
        "ef_search": 20,
        "num_threads": 2,
    }
    update_config: UpdateCollectionConfiguration = {
        "hnsw": update_hnsw,
    }
    coll.modify(configuration=update_config)

    # Verify updates
    loaded_config = coll.configuration_json
    if loaded_config and isinstance(loaded_config, dict):
        hnsw_config = loaded_config.get("hnsw", {})
        if isinstance(hnsw_config, dict):
            assert hnsw_config.get("ef_search") == 20
            # assert hnsw_config.get("num_threads") == 2
            assert hnsw_config.get("space") == "cosine"
            assert hnsw_config.get("ef_construction") == 100
            assert hnsw_config.get("max_neighbors") == 16


def test_configuration_persistence(client_factories: "ClientFactories") -> None:
    """Test configuration persistence across client restarts"""
    # Use the factory to create the initial client
    client = client_factories.create_client_from_system()
    client.reset()

    # Create collection with specific configuration
    hnsw_config: CreateHNSWConfiguration = {
        "space": "cosine",
        "ef_construction": 100,
        "max_neighbors": 10,
    }
    config: CreateCollectionConfiguration = {
        "hnsw": hnsw_config,
        "embedding_function": CustomEmbeddingFunction(dim=5),
    }

    client.create_collection(
        name="test_persist_config",
        configuration=config,
    )

    # Simulate client restart by creating a new client from the same system
    client2 = client_factories.create_client_from_system()

    coll = client2.get_collection(
        name="test_persist_config",
    )

    loaded_config = load_collection_configuration_from_json(
        coll._model.configuration_json
    )
    if loaded_config and isinstance(loaded_config, dict):
        hnsw_config = cast(CreateHNSWConfiguration, loaded_config.get("hnsw", {}))
        assert hnsw_config.get("space") == "cosine"
        assert hnsw_config.get("ef_construction") == 100
        assert hnsw_config.get("max_neighbors") == 10
        assert hnsw_config.get("ef_search") == 100

        ef = loaded_config.get("embedding_function")
        assert ef is not None
        assert ef.name() == "custom_ef"


def test_configuration_result_format(client: ClientAPI) -> None:
    """Test updating collection configurations"""
    client.reset()

    # Create initial collection
    initial_hnsw: CreateHNSWConfiguration = {
        "ef_search": 10,
        "num_threads": 2,
        "space": "cosine",  # Required field
    }
    coll = client.create_collection(
        name="test_updates",
        configuration={"hnsw": initial_hnsw},
    )

    assert coll._model.configuration_json is not None
    hnsw_config = coll._model.configuration_json.get("hnsw")
    assert hnsw_config is not None
    assert hnsw_config.get("ef_search") == 10
    # assert hnsw_config.get("num_threads") == 2
    assert hnsw_config.get("space") == "cosine"


def test_empty_spann_configuration(client: ClientAPI) -> None:
    """Test creating collections with SPANN configuration format"""
    client.reset()

    # Create with SPANN configuration
    spann_config: CreateSpannConfiguration = {}
    config: CreateCollectionConfiguration = {
        "spann": spann_config,
        "embedding_function": CustomEmbeddingFunction(dim=5),
    }

    if is_spann_disabled_mode:
        coll = client.create_collection(
            name="test_spann_config",
            configuration=config,
        )

        # Verify configuration is preserved
        loaded_config = load_collection_configuration_from_json(
            coll._model.configuration_json
        )
        if loaded_config and isinstance(loaded_config, dict):
            hnsw_config_loaded = cast(
                CreateHNSWConfiguration, loaded_config.get("hnsw", {})
            )
            ef = loaded_config.get("embedding_function")
            assert hnsw_config_loaded.get("space") == "l2"
            assert hnsw_config_loaded.get("ef_construction") == 100
            assert hnsw_config_loaded.get("ef_search") == 100
            assert hnsw_config_loaded.get("max_neighbors") == 16
            assert ef is not None
    else:
        coll = client.create_collection(
            name="test_spann_config",
            configuration=config,
        )

        # Verify configuration is preserved
        loaded_config = load_collection_configuration_from_json(
            coll._model.configuration_json
        )
        if loaded_config and isinstance(loaded_config, dict):
            spann_config_loaded = cast(
                CreateSpannConfiguration, loaded_config.get("spann", {})
            )
            ef = loaded_config.get("embedding_function")
            assert spann_config_loaded.get("space") == "l2"
            assert spann_config_loaded.get("ef_construction") == 200
            assert spann_config_loaded.get("ef_search") == 200
            assert spann_config_loaded.get("max_neighbors") == 64
            assert spann_config_loaded.get("search_nprobe") == 128
            assert spann_config_loaded.get("write_nprobe") == 128
            assert ef is not None


def test_spann_configuration(client: ClientAPI) -> None:
    """Test creating collections with SPANN configuration format"""
    client.reset()

    # Create with SPANN configuration
    spann_config: CreateSpannConfiguration = {
        "space": "cosine",
        "ef_construction": 100,
        "max_neighbors": 10,
        "ef_search": 20,
        "search_nprobe": 5,
        "write_nprobe": 10,
    }
    config: CreateCollectionConfiguration = {
        "spann": spann_config,
        "embedding_function": CustomEmbeddingFunction(dim=5),
    }

    if is_spann_disabled_mode:
        coll = client.create_collection(
            name="test_spann_config",
            configuration=config,
        )

        # Verify configuration is preserved
        loaded_config = load_collection_configuration_from_json(
            coll._model.configuration_json
        )
        if loaded_config and isinstance(loaded_config, dict):
            hnsw_config_loaded = cast(
                CreateHNSWConfiguration, loaded_config.get("hnsw", {})
            )
            ef = loaded_config.get("embedding_function")
            assert hnsw_config_loaded.get("space") == "cosine"
            assert hnsw_config_loaded.get("ef_construction") == 100
            assert hnsw_config_loaded.get("ef_search") == 100
            assert hnsw_config_loaded.get("max_neighbors") == 16
            assert ef is not None
    else:
        coll = client.create_collection(
            name="test_spann_config",
            configuration=config,
        )

        # Verify configuration is preserved
        loaded_config = load_collection_configuration_from_json(
            coll._model.configuration_json
        )
        if loaded_config and isinstance(loaded_config, dict):
            spann_config_loaded = cast(
                CreateSpannConfiguration, loaded_config.get("spann", {})
            )
            ef = loaded_config.get("embedding_function")
            assert spann_config_loaded.get("space") == "cosine"
            assert spann_config_loaded.get("ef_construction") == 100
            assert spann_config_loaded.get("ef_search") == 200
            assert spann_config_loaded.get("max_neighbors") == 10
            assert spann_config_loaded.get("search_nprobe") == 5
            assert spann_config_loaded.get("write_nprobe") == 10
            assert ef is not None


@pytest.mark.skipif(is_spann_disabled_mode, reason=skip_reason_spann_disabled)
def test_spann_configuration_persistence(client_factories: "ClientFactories") -> None:
    """Test SPANN configuration persistence across client restarts"""
    client = client_factories.create_client_from_system()
    client.reset()

    # Create collection with specific SPANN configuration
    spann_config: CreateSpannConfiguration = {
        "space": "cosine",
        "ef_construction": 100,
        "max_neighbors": 10,
        "search_nprobe": 5,
        "write_nprobe": 10,
    }
    config: CreateCollectionConfiguration = {
        "spann": spann_config,
        "embedding_function": CustomEmbeddingFunction(dim=5),
    }

    client.create_collection(
        name="test_persist_spann_config",
        configuration=config,
    )

    client2 = client_factories.create_client_from_system()

    coll = client2.get_collection(
        name="test_persist_spann_config",
    )

    loaded_config = load_collection_configuration_from_json(
        coll._model.configuration_json
    )
    if loaded_config and isinstance(loaded_config, dict):
        spann_config = cast(CreateSpannConfiguration, loaded_config.get("spann", {}))
        ef = loaded_config.get("embedding_function")
        assert spann_config.get("space") == "cosine"
        assert spann_config.get("ef_construction") == 100
        assert spann_config.get("max_neighbors") == 10
        assert spann_config.get("search_nprobe") == 5
        assert spann_config.get("write_nprobe") == 10
        assert ef is not None


def test_exclusive_hnsw_spann_configuration(client: ClientAPI) -> None:
    """Test that HNSW and SPANN configurations cannot both be specified"""
    client.reset()

    # Attempt to create with both HNSW and SPANN configurations
    hnsw_config: CreateHNSWConfiguration = {
        "space": "cosine",
        "ef_construction": 100,
    }
    spann_config: CreateSpannConfiguration = {
        "space": "cosine",
        "search_nprobe": 5,
    }

    # This validation always runs and raises ValueError if both are provided,
    # regardless of whether SPANN is generally allowed or not.
    with pytest.raises(ValueError, match="hnsw and spann cannot both be provided"):
        client.create_collection(
            name="test_dual_config",
            configuration={
                "hnsw": hnsw_config,
                "spann": spann_config,
            },
        )


def test_spann_default_parameters(client: ClientAPI) -> None:
    """Test the default values for SPANN parameters"""
    client.reset()

    # Create with minimal SPANN configuration
    spann_config: CreateSpannConfiguration = {
        "space": "cosine",
    }
    config: CreateCollectionConfiguration = {
        "spann": spann_config,
    }

    if is_spann_disabled_mode:
        coll = client.create_collection(
            name="test_spann_defaults",
            configuration=config,
        )

        # Verify configuration is preserved
        loaded_config = load_collection_configuration_from_json(
            coll._model.configuration_json
        )
        if loaded_config and isinstance(loaded_config, dict):
            hnsw_config_loaded = cast(
                CreateHNSWConfiguration, loaded_config.get("hnsw", {})
            )
            assert hnsw_config_loaded.get("space") == "cosine"
            assert hnsw_config_loaded.get("ef_construction") == 100
            assert hnsw_config_loaded.get("ef_search") == 100
            assert hnsw_config_loaded.get("max_neighbors") == 16

            ef = loaded_config.get("embedding_function")
            assert ef is not None
            assert ef.name() == "default"
    else:
        coll = client.create_collection(
            name="test_spann_defaults",
            configuration=config,
        )

        # Verify default values are populated
        loaded_config = load_collection_configuration_from_json(
            coll._model.configuration_json
        )
        if loaded_config and isinstance(loaded_config, dict):
            spann_config_loaded = cast(
                CreateSpannConfiguration, loaded_config.get("spann", {})
            )
            assert spann_config_loaded.get("space") == "cosine"
            assert spann_config_loaded.get("ef_construction") == 200
            assert spann_config_loaded.get("max_neighbors") == 16
            assert spann_config_loaded.get("ef_search") == 200
            assert spann_config_loaded.get("search_nprobe") == 128
            assert spann_config_loaded.get("write_nprobe") == 128

            ef = loaded_config.get("embedding_function")
            assert ef is not None
            assert ef.name() == "default"


def test_spann_json_serialization(client: ClientAPI) -> None:
    """Test serializing and deserializing SPANN configuration to/from JSON"""
    client.reset()

    # Create JSON configuration with SPANN config
    config_json = """
    {
        "spann": {
            "space": "cosine",
            "search_nprobe": 7,
            "write_nprobe": 15,
            "ef_construction": 200,
            "ef_search": 150
        },
        "embedding_function": {
            "type": "known",
            "name": "custom_ef",
            "config": {
                "dim": 10
            }
        }
    }
    """

    # Load the configuration from JSON
    collection_config = load_collection_configuration_from_json(json.loads(config_json))

    # Convert to CreateCollectionConfiguration for collection creation
    create_config: CreateCollectionConfiguration = {}
    if collection_config.get("spann") is not None:
        create_config["spann"] = cast(
            CreateSpannConfiguration, collection_config.get("spann")
        )
    if collection_config.get("embedding_function") is not None:
        create_config["embedding_function"] = collection_config.get(
            "embedding_function"
        )

    if is_spann_disabled_mode:
        coll = client.create_collection(
            name="test_spann_json",
            configuration=create_config,
        )

        # Verify configuration is preserved
        loaded_config = load_collection_configuration_from_json(
            coll._model.configuration_json
        )
        if loaded_config and isinstance(loaded_config, dict):
            hnsw_config_loaded = cast(
                CreateHNSWConfiguration, loaded_config.get("hnsw", {})
            )
            ef = loaded_config.get("embedding_function")
            assert hnsw_config_loaded.get("space") == "cosine"
            assert hnsw_config_loaded.get("ef_construction") == 100
            assert hnsw_config_loaded.get("ef_search") == 100
            assert hnsw_config_loaded.get("max_neighbors") == 16
            assert ef is not None
    else:
        # Create collection with the converted configuration
        coll = client.create_collection(
            name="test_spann_json",
            configuration=create_config,
        )

        # Verify the configuration was preserved correctly
        loaded_config = load_collection_configuration_from_json(
            coll._model.configuration_json
        )
        if loaded_config and isinstance(loaded_config, dict):
            spann_config_loaded = cast(
                CreateSpannConfiguration, loaded_config.get("spann", {})
            )
            assert spann_config_loaded.get("space") == "cosine"
            assert spann_config_loaded.get("search_nprobe") == 7
            assert spann_config_loaded.get("write_nprobe") == 15
            assert spann_config_loaded.get("ef_construction") == 200
            assert spann_config_loaded.get("ef_search") == 150


@pytest.mark.skipif(is_spann_disabled_mode, reason=skip_reason_spann_disabled)
def test_configuration_spann_updates(client: ClientAPI) -> None:
    """Test updating SPANN collection configurations"""
    client.reset()

    # Create initial collection with SPANN
    initial_spann: CreateSpannConfiguration = {
        "ef_search": 100,
        "search_nprobe": 10,
        "space": "cosine",
    }
    coll = client.create_collection(
        name="test_spann_updates",
        configuration={"spann": initial_spann},
    )

    # Update SPANN configuration
    update_spann: UpdateSpannConfiguration = {
        "ef_search": 150,
        "search_nprobe": 20,
    }
    update_config: UpdateCollectionConfiguration = {
        "spann": update_spann,
    }
    coll.modify(configuration=update_config)

    # Verify updates were applied
    loaded_config = coll.configuration_json
    if loaded_config and isinstance(loaded_config, dict):
        spann_config = loaded_config.get("spann", {})
        if isinstance(spann_config, dict):
            assert spann_config.get("ef_search") == 150
            assert spann_config.get("search_nprobe") == 20
            # Original values should remain unchanged
            assert spann_config.get("space") == "cosine"


@pytest.mark.skipif(is_spann_disabled_mode, reason=skip_reason_spann_disabled)
def test_spann_update_from_json(client: ClientAPI) -> None:
    """Test updating SPANN configuration from JSON and applying it"""
    client.reset()

    # Create initial collection with SPANN
    initial_spann: CreateSpannConfiguration = {
        "ef_search": 100,
        "search_nprobe": 10,
        "space": "cosine",
        "ef_construction": 150,
        "max_neighbors": 12,
        "write_nprobe": 20,
    }
    coll = client.create_collection(
        name="test_spann_json_update",
        configuration={"spann": initial_spann},
    )

    update_config = UpdateCollectionConfiguration(
        spann=UpdateSpannConfiguration(
            search_nprobe=15,
            ef_search=200,
        )
    )

    # Apply the update
    coll.modify(configuration=update_config)

    # Verify updates were applied
    loaded_config = coll.configuration_json
    if loaded_config and isinstance(loaded_config, dict):
        spann_config = loaded_config.get("spann", {})
        if isinstance(spann_config, dict):
            # Updated values
            assert spann_config.get("ef_search") == 200
            assert spann_config.get("search_nprobe") == 15

            # Unchanged values
            assert spann_config.get("space") == "cosine"
            assert spann_config.get("ef_construction") == 150
            assert spann_config.get("max_neighbors") == 12
            assert spann_config.get("write_nprobe") == 20


def test_overwrite_spann_configuration() -> None:
    """Test the overwrite_spann_configuration function directly"""
    # Create original SPANN configuration
    original_config: SpannConfiguration = {
        "space": "cosine",
        "search_nprobe": 10,
        "write_nprobe": 20,
        "ef_construction": 150,
        "ef_search": 100,
        "max_neighbors": 16,
    }

    # Create update configuration with only a few fields
    update_config: UpdateSpannConfiguration = {
        "search_nprobe": 15,
        "ef_search": 200,
    }

    # Apply the update
    updated_config = overwrite_spann_configuration(original_config, update_config)

    # Verify updated fields
    assert updated_config.get("search_nprobe") == 15
    assert updated_config.get("ef_search") == 200

    # Verify other fields remain unchanged
    assert updated_config.get("space") == "cosine"
    assert updated_config.get("write_nprobe") == 20
    assert updated_config.get("ef_construction") == 150
    assert updated_config.get("max_neighbors") == 16


@pytest.mark.skipif(is_spann_disabled_mode, reason=skip_reason_spann_disabled)
def test_exclusive_update_hnsw_spann_configuration(client: ClientAPI) -> None:
    """Test that HNSW and SPANN configurations cannot both be specified in an update"""
    client.reset()

    # Create initial collection with HNSW
    initial_hnsw: CreateHNSWConfiguration = {
        "ef_search": 10,
        "space": "cosine",
    }
    coll = client.create_collection(
        name="test_exclusive_update",
        configuration={"hnsw": initial_hnsw},
    )

    # Try to update with both HNSW and SPANN
    update_hnsw: UpdateHNSWConfiguration = {
        "ef_search": 20,
    }
    update_spann: UpdateSpannConfiguration = {
        "search_nprobe": 15,
    }
    update_config: UpdateCollectionConfiguration = {
        "hnsw": update_hnsw,
        "spann": update_spann,
    }

    # This should raise a ValueError
    with pytest.raises(ValueError):
        coll.modify(configuration=update_config)


def test_default_collection_creation(client: ClientAPI) -> None:
    """Test creating a collection with default values"""
    client.reset()

    coll = client.create_collection(name="test_default_creation")
    assert coll is not None

    assert coll.configuration_json is not None
    config = load_collection_configuration_from_json(coll.configuration_json)
    assert config is not None
    hnsw_config = config.get("hnsw")
    assert hnsw_config is not None
    assert hnsw_config.get("space") == "l2"
    assert hnsw_config.get("ef_construction") == 100
    assert hnsw_config.get("max_neighbors") == 16
    assert hnsw_config.get("ef_search") == 100
    # assert hnsw_config.get("batch_size") == 100
    assert hnsw_config.get("sync_threshold") == 1000

    assert config.get("spann") is None
    ef = config.get("embedding_function")
    assert ef is not None
    assert ef.name() == "default"


def test_invalid_configuration() -> None:
    """Test that on an invalid configuration, an error is raised"""
    invalid_config: Dict[str, Any] = {
        "hnsw": {
            "space": "l2",
            "ef_construction": 100,
            "ef_search": 100,
            "max_neighbors": 16,
            "resize_factor": 1.2,
            "sync_threshold": 1000,
        },
        "spann": None,
        "embedding_function": {
            "name": "custom_ef",
            "type": "known",
            "config": {},
        },
    }
    with pytest.raises(ValueError):
        load_collection_configuration_from_json(invalid_config)


def test_collection_load_with_invalid_configuration(client: ClientAPI) -> None:
    """
    When an invalid confiugration is used, collection create, get, list_collections should all pass
    Only when trying to use the collection should an error be reaised
    """
    client.reset()

    # Create a collection with a valid configuration first
    coll = client.create_collection(name="test_invalid_config")

    # Simulate an invalid configuration by directly modifying the collection model
    # This mimics what would happen if a collection was created with invalid config
    # and stored in the database
    invalid_config_json = {
        "embedding_function": {
            "name": "custom_ef",
            "type": "known",
            "config": {},
        }
    }

    invalid_collection = CollectionModel(
        id=coll.id,
        name="test_invalid_config_collection",
        configuration_json=invalid_config_json,
        metadata=None,
        dimension=None,
        tenant=coll.tenant,
        database=coll.database,
    )

    assert invalid_collection is not None
    assert invalid_collection.name == "test_invalid_config_collection"
    assert invalid_collection.configuration_json == invalid_config_json

    coll._model = invalid_collection

    with pytest.raises(ValueError):
        coll.add(ids=["1"], documents=["test"])

    with pytest.raises(ValueError):
        coll.query(query_texts=["test"], n_results=1)


def test_configuration_json_vs_configuration_property_consistency(
    client: ClientAPI,
) -> None:
    """Test that configuration_json and configuration properties are consistent"""
    client.reset()

    config: CreateCollectionConfiguration = {
        "embedding_function": CustomEmbeddingFunction(dim=8),
    }

    coll = client.create_collection(
        name="test_config_consistency",
        configuration=config,
    )

    # Get both raw JSON and processed configuration
    config_json = coll.configuration_json
    config_processed = coll.configuration

    assert "embedding_function" in config_json

    # Verify embedding function consistency
    ef_json = config_json.get("embedding_function")
    ef_processed = config_processed.get("embedding_function")
    assert ef_json is not None
    assert ef_processed is not None
    assert ef_json.get("type") == "known"
    assert ef_json.get("name") == "custom_ef"
    assert ef_processed.name() == "custom_ef"
    assert ef_processed.get_config() == ef_json.get("config")


def test_default_configuration_json_vs_configuration_property_consistency(
    client: ClientAPI,
) -> None:
    """Test that default configuration_json and configuration properties are consistent"""
    client.reset()

    # Create collection with default configuration
    coll = client.create_collection(name="test_default_config_consistency")

    # Get both raw JSON and processed configuration
    config_json = coll.configuration_json
    config_processed = coll.configuration

    assert "embedding_function" in config_json

    # Verify default embedding function
    ef_json = config_json.get("embedding_function")
    ef_processed = config_processed.get("embedding_function")
    assert ef_json is not None
    assert ef_processed is not None
    assert ef_json.get("type") == "known"
    assert ef_json.get("name") == "default"
    assert ef_processed.name() == "default"


def test_invalid_configuration_operations_succeed_until_embed(
    client: ClientAPI,
) -> None:
    """
    Test that invalid configurations allow list_collections, get_collection to succeed,
    but fail when _embed is called (during add, query, upsert operations)
    """
    client.reset()

    # Create a collection with valid configuration first
    coll = client.create_collection(name="test_invalid_operations")

    # Create collections with various invalid configurations
    # and verify which operations succeed vs fail
    invalid_configs: List[Dict[str, Any]] = [
        # Missing embedding function config
        {
            "embedding_function": {
                "name": "nonexistent_ef",
                "type": "known",
                "config": {},
            }
        },
        # Malformed embedding function config
        {
            "embedding_function": {
                "type": "known",
                # Missing 'name' field
                "config": {"dim": 3},
            }
        },
        # HNSW and SPANN both present (invalid)
        {
            "hnsw": {"space": "l2"},
            "spann": {"space": "cosine"},
            "embedding_function": {"type": "legacy"},
        },
    ]

    for i, invalid_config in enumerate(invalid_configs):
        # Simulate an invalid configuration by directly modifying the collection model
        invalid_collection_model = CollectionModel(
            id=coll.id,
            name=f"test_invalid_config_{i}",
            configuration_json=invalid_config,
            metadata=None,
            dimension=None,
            tenant=coll.tenant,
            database=coll.database,
        )

        coll._model = invalid_collection_model

        # These operations should succeed (they don't process configuration)
        assert coll.id == invalid_collection_model.id
        assert coll.name == f"test_invalid_config_{i}"
        assert coll.configuration_json == invalid_config

        with pytest.raises(ValueError):
            coll.configuration

        with pytest.raises(ValueError):
            coll.add(ids=["1"], documents=["test"])

        with pytest.raises(ValueError):
            coll.query(query_texts=["test"], n_results=1)

        with pytest.raises(ValueError):
            coll.upsert(ids=["1"], documents=["test"])

        with pytest.raises(ValueError):
            coll._embed(["test"])


def test_get_collection_with_invalid_configuration(client: ClientAPI) -> None:
    """
    Test that get_collection works even with invalid configurations,
    but operations that require _embed fail
    """
    client.reset()

    # Create a valid collection first
    valid_coll = client.create_collection(
        name="test_get_invalid",
        configuration={"embedding_function": CustomEmbeddingFunction(dim=4)},
    )

    # Simulate database corruption or invalid configuration
    # by directly modifying the model's configuration
    invalid_config = {
        "embedding_function": {
            "name": "nonexistent_function",
            "type": "known",
            "config": {"dim": 4},
        }
    }

    # Update the collection's configuration to be invalid
    valid_coll._model.configuration_json = invalid_config

    # get_collection-like operations should still work
    assert valid_coll.name == "test_get_invalid"
    assert valid_coll.id is not None
    assert valid_coll.configuration_json == invalid_config
    assert valid_coll.tenant is not None
    assert valid_coll.database is not None

    # But operations requiring embedding should fail
    with pytest.raises(ValueError):
        valid_coll.add(ids=["test"], documents=["test doc"])

    with pytest.raises(ValueError):
        valid_coll.query(query_texts=["test"], n_results=1)

    with pytest.raises(ValueError):
        valid_coll.upsert(ids=["test"], documents=["test doc"])

    # Accessing configuration property should also fail
    with pytest.raises(ValueError):
        _ = valid_coll.configuration


def test_ef_no_config(client: ClientAPI) -> None:
    """Test creating a collection with no EF in config."""
    client.reset()
    coll = client.create_collection(
        name="test_no_config", embedding_function=CustomEmbeddingFunction(dim=3)
    )
    assert coll is not None
    ef = coll.configuration.get("embedding_function")
    assert ef is not None
    assert ef.name() == "custom_ef"
    assert ef.get_config() == {"dim": 3}

    coll = client.get_or_create_collection(
        name="test_no_config", embedding_function=CustomEmbeddingFunction(dim=3)
    )
    assert coll is not None
    ef = coll.configuration.get("embedding_function")
    assert ef is not None
    assert ef.name() == "custom_ef"
    assert ef.get_config() == {"dim": 3}

    coll = client.get_collection(name="test_no_config")
    ef = coll.configuration.get("embedding_function")
    assert ef is not None
    assert ef.name() == "custom_ef"
    assert ef.get_config() == {"dim": 3}


def test_ef_with_config_exists_no_ef(client: ClientAPI) -> None:
    """Test creating a collection with EF in parameter, no EF in config."""
    client.reset()
    coll = client.create_collection(
        name="test_ef_with_config_exists_no_ef",
        embedding_function=CustomEmbeddingFunction(dim=3),
        configuration={"hnsw": {"space": "cosine"}},
    )
    assert coll is not None
    ef = coll.configuration.get("embedding_function")
    assert ef is not None
    assert ef.name() == "custom_ef"
    assert ef.get_config() == {"dim": 3}

    coll = client.get_or_create_collection(
        name="test_ef_with_config_exists_no_ef",
        embedding_function=CustomEmbeddingFunction(dim=3),
        configuration={"hnsw": {"space": "cosine"}},
    )
    assert coll is not None
    ef = coll.configuration.get("embedding_function")
    assert ef is not None
    assert ef.name() == "custom_ef"
    assert ef.get_config() == {"dim": 3}

    coll = client.get_collection(name="test_ef_with_config_exists_no_ef")
    ef = coll.configuration.get("embedding_function")
    assert ef is not None
    assert ef.name() == "custom_ef"
    assert ef.get_config() == {"dim": 3}


def test_ef_with_config_exists_with_ef_valid(client: ClientAPI) -> None:
    """Test creating a collection with EF in parameter, EF in config. They are the same."""
    client.reset()
    coll = client.create_collection(
        name="test_ef_with_config_exists_with_ef",
        embedding_function=CustomEmbeddingFunction(dim=3),
        configuration={
            "hnsw": {"space": "cosine"},
            "embedding_function": CustomEmbeddingFunction(dim=3),
        },
    )
    assert coll is not None
    ef = coll.configuration.get("embedding_function")
    assert ef is not None
    assert ef.name() == "custom_ef"
    assert ef.get_config() == {"dim": 3}

    coll = client.get_or_create_collection(
        name="test_ef_with_config_exists_with_ef",
        embedding_function=CustomEmbeddingFunction(dim=3),
        configuration={
            "hnsw": {"space": "cosine"},
            "embedding_function": CustomEmbeddingFunction(dim=3),
        },
    )
    assert coll is not None
    ef = coll.configuration.get("embedding_function")
    assert ef is not None
    assert ef.name() == "custom_ef"
    assert ef.get_config() == {"dim": 3}

    coll = client.get_collection(name="test_ef_with_config_exists_with_ef")
    ef = coll.configuration.get("embedding_function")
    assert ef is not None
    assert ef.name() == "custom_ef"
    assert ef.get_config() == {"dim": 3}


def test_create_ef_with_config_exists_with_ef_invalid(client: ClientAPI) -> None:
    """Test creating a collection with EF in parameter, EF in config. They are different."""
    client.reset()
    with pytest.raises(ValueError):
        client.create_collection(
            name="test_ef_with_config_exists_with_ef",
            embedding_function=CustomEmbeddingFunction(dim=3),
            configuration={
                "hnsw": {"space": "cosine"},
                "embedding_function": CustomEmbeddingFunction2(dim=3),
            },
        )


def test_get_or_create_ef_with_config_exists_with_ef_invalid(client: ClientAPI) -> None:
    """Test get_or_create with EF in parameter, EF in config. They are different."""
    client.reset()
    with pytest.raises(ValueError):
        client.get_or_create_collection(
            name="test_ef_with_config_exists_with_ef",
            embedding_function=CustomEmbeddingFunction(dim=3),
            configuration={
                "hnsw": {"space": "cosine"},
                "embedding_function": CustomEmbeddingFunction2(dim=3),
            },
        )


def test_get_collection_ef_with_config_exists_with_ef_invalid(
    client: ClientAPI,
) -> None:
    """Test get_collection with EF in parameter, EF in config. They are different."""
    client.reset()
    client.create_collection(
        name="test_ef_with_config_exists_with_ef",
        configuration={
            "hnsw": {"space": "cosine"},
            "embedding_function": CustomEmbeddingFunction2(dim=3),
        },
    )
    with pytest.raises(ValueError):
        client.get_collection(
            name="test_ef_with_config_exists_with_ef",
            embedding_function=CustomEmbeddingFunction(dim=3),
        )


def test_get_or_create_after_create_with_ef(client: ClientAPI) -> None:
    """
    After creating a collection with an embedding function,
    get_or_create should raise an error before and after retrieval, if they had provided
    a different embedding function or if it differs from the persisted one.
    """
    client.reset()
    coll = client.create_collection(
        name="test_get_or_create_after_create_with_ef",
        embedding_function=CustomEmbeddingFunction(dim=3),
    )
    assert coll is not None
    ef = coll.configuration.get("embedding_function")
    assert ef is not None
    assert ef.name() == "custom_ef"
    assert ef.get_config() == {"dim": 3}

    with pytest.raises(ValueError):
        client.get_or_create_collection(
            name="test_get_or_create_after_create_with_ef",
            embedding_function=CustomEmbeddingFunction2(dim=3),
            configuration={"embedding_function": CustomEmbeddingFunction(dim=3)},
        )

    with pytest.raises(ValueError):
        client.get_or_create_collection(
            name="test_get_or_create_after_create_with_ef",
            embedding_function=CustomEmbeddingFunction2(dim=3),
        )
