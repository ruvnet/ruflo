from typing import TypedDict, Dict, Any, Optional, cast, get_args
import json
from chromadb.api.types import (
    Space,
    CollectionMetadata,
    UpdateMetadata,
    EmbeddingFunction,
)
from chromadb.utils.embedding_functions import (
    known_embedding_functions,
    register_embedding_function,
)
from multiprocessing import cpu_count
import warnings


class HNSWConfiguration(TypedDict, total=False):
    space: Space
    ef_construction: int
    max_neighbors: int
    ef_search: int
    num_threads: int
    batch_size: int
    sync_threshold: int
    resize_factor: float


class SpannConfiguration(TypedDict, total=False):
    search_nprobe: int
    write_nprobe: int
    space: Space
    ef_construction: int
    ef_search: int
    max_neighbors: int
    reassign_neighbor_count: int
    split_threshold: int
    merge_threshold: int


class CollectionConfiguration(TypedDict, total=True):
    hnsw: Optional[HNSWConfiguration]
    spann: Optional[SpannConfiguration]
    embedding_function: Optional[EmbeddingFunction]  # type: ignore


def load_collection_configuration_from_json_str(
    config_json_str: str,
) -> CollectionConfiguration:
    config_json_map = json.loads(config_json_str)
    return load_collection_configuration_from_json(config_json_map)


# TODO: make warnings prettier and add link to migration docs
def load_collection_configuration_from_json(
    config_json_map: Dict[str, Any]
) -> CollectionConfiguration:
    if (
        config_json_map.get("spann") is not None
        and config_json_map.get("hnsw") is not None
    ):
        raise ValueError("hnsw and spann cannot both be provided")

    hnsw_config = None
    spann_config = None
    ef_config = None

    # Process vector index configuration (HNSW or SPANN)
    if config_json_map.get("hnsw") is not None:
        hnsw_config = cast(HNSWConfiguration, config_json_map["hnsw"])
    if config_json_map.get("spann") is not None:
        spann_config = cast(SpannConfiguration, config_json_map["spann"])

    # Process embedding function configuration
    if config_json_map.get("embedding_function") is not None:
        ef_config = config_json_map["embedding_function"]
        if ef_config["type"] == "legacy":
            warnings.warn(
                "legacy embedding function config",
                DeprecationWarning,
                stacklevel=2,
            )
            ef = None
        else:
            try:
                ef_name = ef_config["name"]
            except KeyError:
                raise ValueError(
                    f"Embedding function name not found in config: {ef_config}"
                )
            try:
                ef = known_embedding_functions[ef_name]
            except KeyError:
                raise ValueError(
                    f"Embedding function {ef_name} not found. Add @register_embedding_function decorator to the class definition."
                )
            try:
                ef = ef.build_from_config(ef_config["config"])  # type: ignore
            except Exception as e:
                raise ValueError(
                    f"Could not build embedding function {ef_config['name']} from config {ef_config['config']}: {e}"
                )

    else:
        ef = None

    return CollectionConfiguration(
        hnsw=hnsw_config,
        spann=spann_config,
        embedding_function=ef,  # type: ignore
    )


def collection_configuration_to_json_str(config: CollectionConfiguration) -> str:
    return json.dumps(collection_configuration_to_json(config))


def collection_configuration_to_json(config: CollectionConfiguration) -> Dict[str, Any]:
    if isinstance(config, dict):
        hnsw_config = config.get("hnsw")
        spann_config = config.get("spann")
        ef = config.get("embedding_function")
    else:
        try:
            hnsw_config = config.get_parameter("hnsw").value
        except ValueError:
            hnsw_config = None
        try:
            spann_config = config.get_parameter("spann").value
        except ValueError:
            spann_config = None
        try:
            ef = config.get_parameter("embedding_function").value
        except ValueError:
            ef = None

    ef_config: Dict[str, Any] | None = None
    if hnsw_config is not None:
        try:
            hnsw_config = cast(HNSWConfiguration, hnsw_config)
        except Exception as e:
            raise ValueError(f"not a valid hnsw config: {e}")
    if spann_config is not None:
        try:
            spann_config = cast(SpannConfiguration, spann_config)
        except Exception as e:
            raise ValueError(f"not a valid spann config: {e}")

    if ef is None:
        ef = None
        ef_config = {"type": "legacy"}
        return {
            "hnsw": hnsw_config,
            "spann": spann_config,
            "embedding_function": ef_config,
        }

    if ef is not None:
        try:
            if ef.is_legacy():
                ef_config = {"type": "legacy"}
            else:
                ef_config = {
                    "name": ef.name(),
                    "type": "known",
                    "config": ef.get_config(),
                }
                register_embedding_function(type(ef))  # type: ignore
        except Exception as e:
            warnings.warn(
                f"legacy embedding function config: {e}",
                DeprecationWarning,
                stacklevel=2,
            )
            ef = None
            ef_config = {"type": "legacy"}

    return {
        "hnsw": hnsw_config,
        "spann": spann_config,
        "embedding_function": ef_config,
    }


class CreateHNSWConfiguration(TypedDict, total=False):
    space: Space
    ef_construction: int
    max_neighbors: int
    ef_search: int
    num_threads: int
    batch_size: int
    sync_threshold: int
    resize_factor: float


def json_to_create_hnsw_configuration(
    json_map: Dict[str, Any]
) -> CreateHNSWConfiguration:
    config: CreateHNSWConfiguration = {}
    if "space" in json_map:
        space_value = json_map["space"]
        if space_value in get_args(Space):
            config["space"] = space_value
        else:
            raise ValueError(f"not a valid space: {space_value}")
    if "ef_construction" in json_map:
        config["ef_construction"] = json_map["ef_construction"]
    if "max_neighbors" in json_map:
        config["max_neighbors"] = json_map["max_neighbors"]
    if "ef_search" in json_map:
        config["ef_search"] = json_map["ef_search"]
    if "num_threads" in json_map:
        config["num_threads"] = json_map["num_threads"]
    if "batch_size" in json_map:
        config["batch_size"] = json_map["batch_size"]
    if "sync_threshold" in json_map:
        config["sync_threshold"] = json_map["sync_threshold"]
    if "resize_factor" in json_map:
        config["resize_factor"] = json_map["resize_factor"]
    return config


class CreateSpannConfiguration(TypedDict, total=False):
    search_nprobe: int
    write_nprobe: int
    space: Space
    ef_construction: int
    ef_search: int
    max_neighbors: int
    reassign_neighbor_count: int
    split_threshold: int
    merge_threshold: int


def json_to_create_spann_configuration(
    json_map: Dict[str, Any]
) -> CreateSpannConfiguration:
    config: CreateSpannConfiguration = {}
    if "search_nprobe" in json_map:
        config["search_nprobe"] = json_map["search_nprobe"]
    if "write_nprobe" in json_map:
        config["write_nprobe"] = json_map["write_nprobe"]
    if "space" in json_map:
        space_value = json_map["space"]
        if space_value in get_args(Space):
            config["space"] = space_value
        else:
            raise ValueError(f"not a valid space: {space_value}")
    if "ef_construction" in json_map:
        config["ef_construction"] = json_map["ef_construction"]
    if "ef_search" in json_map:
        config["ef_search"] = json_map["ef_search"]
    if "max_neighbors" in json_map:
        config["max_neighbors"] = json_map["max_neighbors"]
    return config


class CreateCollectionConfiguration(TypedDict, total=False):
    hnsw: Optional[CreateHNSWConfiguration]
    spann: Optional[CreateSpannConfiguration]
    embedding_function: Optional[EmbeddingFunction]  # type: ignore


def load_collection_configuration_from_create_collection_configuration(
    config: CreateCollectionConfiguration,
) -> CollectionConfiguration:
    return CollectionConfiguration(
        hnsw=config.get("hnsw"),
        spann=config.get("spann"),
        embedding_function=config.get("embedding_function"),
    )


def create_collection_configuration_from_legacy_collection_metadata(
    metadata: CollectionMetadata,
) -> CreateCollectionConfiguration:
    """Create a CreateCollectionConfiguration from legacy collection metadata"""
    return create_collection_configuration_from_legacy_metadata_dict(metadata)


def create_collection_configuration_from_legacy_metadata_dict(
    metadata: Dict[str, Any],
) -> CreateCollectionConfiguration:
    """Create a CreateCollectionConfiguration from legacy collection metadata"""
    old_to_new = {
        "hnsw:space": "space",
        "hnsw:construction_ef": "ef_construction",
        "hnsw:M": "max_neighbors",
        "hnsw:search_ef": "ef_search",
        "hnsw:num_threads": "num_threads",
        "hnsw:batch_size": "batch_size",
        "hnsw:sync_threshold": "sync_threshold",
        "hnsw:resize_factor": "resize_factor",
    }
    json_map = {}
    for name, value in metadata.items():
        if name in old_to_new:
            json_map[old_to_new[name]] = value
    hnsw_config = json_to_create_hnsw_configuration(json_map)
    hnsw_config = populate_create_hnsw_defaults(hnsw_config)

    return CreateCollectionConfiguration(hnsw=hnsw_config)


def load_create_collection_configuration_from_json_str(
    json_str: str,
) -> CreateCollectionConfiguration:
    json_map = json.loads(json_str)
    return load_create_collection_configuration_from_json(json_map)


# TODO: make warnings prettier and add link to migration docs
def load_create_collection_configuration_from_json(
    json_map: Dict[str, Any]
) -> CreateCollectionConfiguration:
    if json_map.get("hnsw") is not None and json_map.get("spann") is not None:
        raise ValueError("hnsw and spann cannot both be provided")

    result = CreateCollectionConfiguration()

    # Handle vector index configuration
    if json_map.get("hnsw") is not None:
        result["hnsw"] = json_to_create_hnsw_configuration(json_map["hnsw"])

    if json_map.get("spann") is not None:
        result["spann"] = json_to_create_spann_configuration(json_map["spann"])

    # Handle embedding function configuration
    if json_map.get("embedding_function") is not None:
        ef_config = json_map["embedding_function"]
        if ef_config["type"] == "legacy":
            warnings.warn(
                "legacy embedding function config",
                DeprecationWarning,
                stacklevel=2,
            )
        else:
            ef = known_embedding_functions[ef_config["name"]]
            result["embedding_function"] = ef.build_from_config(ef_config["config"])

    return result


def create_collection_configuration_to_json_str(
    config: CreateCollectionConfiguration,
) -> str:
    """Convert a CreateCollection configuration to a JSON-serializable string"""
    return json.dumps(create_collection_configuration_to_json(config))


# TODO: make warnings prettier and add link to migration docs
def create_collection_configuration_to_json(
    config: CreateCollectionConfiguration,
) -> Dict[str, Any]:
    """Convert a CreateCollection configuration to a JSON-serializable dict"""
    ef_config: Dict[str, Any] | None = None
    hnsw_config = config.get("hnsw")
    spann_config = config.get("spann")
    if hnsw_config is not None:
        try:
            hnsw_config = cast(CreateHNSWConfiguration, hnsw_config)
        except Exception as e:
            raise ValueError(f"not a valid hnsw config: {e}")
    if spann_config is not None:
        try:
            spann_config = cast(CreateSpannConfiguration, spann_config)
        except Exception as e:
            raise ValueError(f"not a valid spann config: {e}")

    if hnsw_config is not None and spann_config is not None:
        raise ValueError("hnsw and spann cannot both be provided")

    if config.get("embedding_function") is None:
        ef = None
        ef_config = {"type": "legacy"}
        return {
            "hnsw": hnsw_config,
            "spann": spann_config,
            "embedding_function": ef_config,
        }

    try:
        ef = cast(EmbeddingFunction, config.get("embedding_function"))  # type: ignore
        if ef.is_legacy():
            ef_config = {"type": "legacy"}
        else:
            ef_config = {
                "name": ef.name(),
                "type": "known",
                "config": ef.get_config(),
            }
            register_embedding_function(type(ef))  # type: ignore
    except Exception as e:
        warnings.warn(
            f"legacy embedding function config: {e}",
            DeprecationWarning,
            stacklevel=2,
        )
        ef = None
        ef_config = {"type": "legacy"}

    return {
        "hnsw": hnsw_config,
        "spann": spann_config,
        "embedding_function": ef_config,
    }


def populate_create_hnsw_defaults(
    config: CreateHNSWConfiguration, ef: Optional[EmbeddingFunction] = None  # type: ignore
) -> CreateHNSWConfiguration:
    """Populate a CreateHNSW configuration with default values"""
    if config.get("space") is None:
        config["space"] = ef.default_space() if ef else "l2"
    if config.get("ef_construction") is None:
        config["ef_construction"] = 100
    if config.get("max_neighbors") is None:
        config["max_neighbors"] = 16
    if config.get("ef_search") is None:
        config["ef_search"] = 100
    if config.get("num_threads") is None:
        config["num_threads"] = cpu_count()
    if config.get("batch_size") is None:
        config["batch_size"] = 100
    if config.get("sync_threshold") is None:
        config["sync_threshold"] = 1000
    if config.get("resize_factor") is None:
        config["resize_factor"] = 1.2
    return config


class UpdateHNSWConfiguration(TypedDict, total=False):
    ef_search: int
    num_threads: int
    batch_size: int
    sync_threshold: int
    resize_factor: float


def json_to_update_hnsw_configuration(
    json_map: Dict[str, Any]
) -> UpdateHNSWConfiguration:
    config: UpdateHNSWConfiguration = {}
    if "ef_search" in json_map:
        config["ef_search"] = json_map["ef_search"]
    if "num_threads" in json_map:
        config["num_threads"] = json_map["num_threads"]
    if "batch_size" in json_map:
        config["batch_size"] = json_map["batch_size"]
    if "sync_threshold" in json_map:
        config["sync_threshold"] = json_map["sync_threshold"]
    if "resize_factor" in json_map:
        config["resize_factor"] = json_map["resize_factor"]
    return config


class UpdateSpannConfiguration(TypedDict, total=False):
    search_nprobe: int
    ef_search: int


def json_to_update_spann_configuration(
    json_map: Dict[str, Any]
) -> UpdateSpannConfiguration:
    config: UpdateSpannConfiguration = {}
    if "search_nprobe" in json_map:
        config["search_nprobe"] = json_map["search_nprobe"]
    if "ef_search" in json_map:
        config["ef_search"] = json_map["ef_search"]
    return config


class UpdateCollectionConfiguration(TypedDict, total=False):
    hnsw: Optional[UpdateHNSWConfiguration]
    spann: Optional[UpdateSpannConfiguration]
    embedding_function: Optional[EmbeddingFunction]  # type: ignore


def update_collection_configuration_from_legacy_collection_metadata(
    metadata: CollectionMetadata,
) -> UpdateCollectionConfiguration:
    """Create an UpdateCollectionConfiguration from legacy collection metadata"""
    old_to_new = {
        "hnsw:search_ef": "ef_search",
        "hnsw:num_threads": "num_threads",
        "hnsw:batch_size": "batch_size",
        "hnsw:sync_threshold": "sync_threshold",
        "hnsw:resize_factor": "resize_factor",
    }
    json_map = {}
    for name, value in metadata.items():
        if name in old_to_new:
            json_map[old_to_new[name]] = value
    hnsw_config = json_to_update_hnsw_configuration(json_map)
    return UpdateCollectionConfiguration(hnsw=hnsw_config)


def update_collection_configuration_from_legacy_update_metadata(
    metadata: UpdateMetadata,
) -> UpdateCollectionConfiguration:
    """Create an UpdateCollectionConfiguration from legacy update metadata"""
    old_to_new = {
        "hnsw:search_ef": "ef_search",
        "hnsw:num_threads": "num_threads",
        "hnsw:batch_size": "batch_size",
        "hnsw:sync_threshold": "sync_threshold",
        "hnsw:resize_factor": "resize_factor",
    }
    json_map = {}
    for name, value in metadata.items():
        if name in old_to_new:
            json_map[old_to_new[name]] = value
    hnsw_config = json_to_update_hnsw_configuration(json_map)
    return UpdateCollectionConfiguration(hnsw=hnsw_config)


def update_collection_configuration_to_json_str(
    config: UpdateCollectionConfiguration,
) -> str:
    """Convert an UpdateCollectionConfiguration to a JSON-serializable string"""
    json_dict = update_collection_configuration_to_json(config)
    return json.dumps(json_dict)


def update_collection_configuration_to_json(
    config: UpdateCollectionConfiguration,
) -> Dict[str, Any]:
    """Convert an UpdateCollectionConfiguration to a JSON-serializable dict"""
    hnsw_config = config.get("hnsw")
    spann_config = config.get("spann")
    ef = config.get("embedding_function")
    if hnsw_config is None and spann_config is None and ef is None:
        return {}

    if hnsw_config is not None:
        try:
            hnsw_config = cast(UpdateHNSWConfiguration, hnsw_config)
        except Exception as e:
            raise ValueError(f"not a valid hnsw config: {e}")

    if spann_config is not None:
        try:
            spann_config = cast(UpdateSpannConfiguration, spann_config)
        except Exception as e:
            raise ValueError(f"not a valid spann config: {e}")

    ef_config: Dict[str, Any] | None = None
    if ef is not None:
        if ef.is_legacy():
            ef_config = {"type": "legacy"}
        else:
            ef.validate_config(ef.get_config())
            ef_config = {
                "name": ef.name(),
                "type": "known",
                "config": ef.get_config(),
            }
            register_embedding_function(type(ef))  # type: ignore
    else:
        ef_config = None

    return {
        "hnsw": hnsw_config,
        "spann": spann_config,
        "embedding_function": ef_config,
    }


def load_update_collection_configuration_from_json_str(
    json_str: str,
) -> UpdateCollectionConfiguration:
    json_map = json.loads(json_str)
    return load_update_collection_configuration_from_json(json_map)


# TODO: make warnings prettier and add link to migration docs
def load_update_collection_configuration_from_json(
    json_map: Dict[str, Any]
) -> UpdateCollectionConfiguration:
    """Convert a JSON dict to an UpdateCollectionConfiguration"""
    if json_map.get("hnsw") is not None and json_map.get("spann") is not None:
        raise ValueError("hnsw and spann cannot both be provided")

    result = UpdateCollectionConfiguration()

    # Handle vector index configurations
    if json_map.get("hnsw") is not None:
        result["hnsw"] = json_to_update_hnsw_configuration(json_map["hnsw"])

    if json_map.get("spann") is not None:
        result["spann"] = json_to_update_spann_configuration(json_map["spann"])

    # Handle embedding function
    if json_map.get("embedding_function") is not None:
        if json_map["embedding_function"]["type"] == "legacy":
            warnings.warn(
                "legacy embedding function config",
                DeprecationWarning,
                stacklevel=2,
            )
        else:
            ef = known_embedding_functions[json_map["embedding_function"]["name"]]
            result["embedding_function"] = ef.build_from_config(
                json_map["embedding_function"]["config"]
            )

    return result


def overwrite_hnsw_configuration(
    existing_hnsw_config: HNSWConfiguration, update_hnsw_config: UpdateHNSWConfiguration
) -> HNSWConfiguration:
    """Overwrite a HNSWConfiguration with a new configuration"""
    # Create a copy of the existing config and update with new values
    result = dict(existing_hnsw_config)
    update_fields = [
        "ef_search",
        "num_threads",
        "batch_size",
        "sync_threshold",
        "resize_factor",
    ]

    for field in update_fields:
        if field in update_hnsw_config:
            result[field] = update_hnsw_config[field]  # type: ignore

    return cast(HNSWConfiguration, result)


def overwrite_spann_configuration(
    existing_spann_config: SpannConfiguration,
    update_spann_config: UpdateSpannConfiguration,
) -> SpannConfiguration:
    """Overwrite a SpannConfiguration with a new configuration"""
    result = dict(existing_spann_config)
    update_fields = [
        "search_nprobe",
        "ef_search",
    ]

    for field in update_fields:
        if field in update_spann_config:
            result[field] = update_spann_config[field]  # type: ignore

    return cast(SpannConfiguration, result)


# TODO: make warnings prettier and add link to migration docs
def overwrite_embedding_function(
    existing_embedding_function: EmbeddingFunction,  # type: ignore
    update_embedding_function: EmbeddingFunction,  # type: ignore
) -> EmbeddingFunction:  # type: ignore
    """Overwrite an EmbeddingFunction with a new configuration"""
    # Check for legacy embedding functions
    if existing_embedding_function.is_legacy() or update_embedding_function.is_legacy():
        warnings.warn(
            "cannot update legacy embedding function config",
            DeprecationWarning,
            stacklevel=2,
        )
        return existing_embedding_function

    # Validate function compatibility
    if existing_embedding_function.name() != update_embedding_function.name():
        raise ValueError(
            f"Cannot update embedding function: incompatible types "
            f"({existing_embedding_function.name()} vs {update_embedding_function.name()})"
        )

    # Validate and apply the configuration update
    update_embedding_function.validate_config_update(
        existing_embedding_function.get_config(), update_embedding_function.get_config()
    )
    return update_embedding_function


def overwrite_collection_configuration(
    existing_config: CollectionConfiguration,
    update_config: UpdateCollectionConfiguration,
) -> CollectionConfiguration:
    """Overwrite a CollectionConfiguration with a new configuration"""
    update_spann = update_config.get("spann")
    update_hnsw = update_config.get("hnsw")
    if update_spann is not None and update_hnsw is not None:
        raise ValueError("hnsw and spann cannot both be provided")

    # Handle HNSW configuration update

    updated_hnsw_config = existing_config.get("hnsw")
    if updated_hnsw_config is not None and update_hnsw is not None:
        updated_hnsw_config = overwrite_hnsw_configuration(
            updated_hnsw_config, update_hnsw
        )

    # Handle SPANN configuration update
    updated_spann_config = existing_config.get("spann")
    if updated_spann_config is not None and update_spann is not None:
        updated_spann_config = overwrite_spann_configuration(
            updated_spann_config, update_spann
        )

    # Handle embedding function update
    updated_embedding_function = existing_config.get("embedding_function")
    update_ef = update_config.get("embedding_function")
    if update_ef is not None:
        if updated_embedding_function is not None:
            updated_embedding_function = overwrite_embedding_function(
                updated_embedding_function, update_ef
            )
        else:
            updated_embedding_function = update_ef

    return CollectionConfiguration(
        hnsw=updated_hnsw_config,
        spann=updated_spann_config,
        embedding_function=updated_embedding_function,
    )


def validate_embedding_function_conflict_on_create(
    embedding_function: Optional[EmbeddingFunction],  # type: ignore
    configuration_ef: Optional[EmbeddingFunction],  # type: ignore
) -> None:
    """
    Validates that there are no conflicting embedding functions between function parameter
    and collection configuration.

    Args:
        embedding_function: The embedding function provided as a parameter
        configuration_ef: The embedding function from collection configuration

    Returns:
        bool: True if there is a conflict, False otherwise
    """
    # If ef provided in function params and collection config, check if they are the same
    # If not, there's a conflict
    # ef is by default "default" if not provided, so ignore that case.
    if embedding_function is not None and configuration_ef is not None:
        if (
            embedding_function.name() != "default"
            and embedding_function.name() != configuration_ef.name()
        ):
            raise ValueError(
                f"Multiple embedding functions provided. Please provide only one. Embedding function conflict: {embedding_function.name()} vs {configuration_ef.name()}"
            )
    return None


# The reason to use the config on get, rather than build the ef is because
# if there is an issue with deserializing the config, an error shouldn't be raised
# at get time. CollectionCommon.py will raise an error at _embed time if there is an issue deserializing.
def validate_embedding_function_conflict_on_get(
    embedding_function: Optional[EmbeddingFunction],  # type: ignore
    persisted_ef_config: Optional[Dict[str, Any]],
) -> None:
    """
    Validates that there are no conflicting embedding functions between function parameter
    and collection configuration.
    """
    if persisted_ef_config is not None and embedding_function is not None:
        if (
            embedding_function.name() != "default"
            and persisted_ef_config.get("name") is not None
            and persisted_ef_config.get("name") != embedding_function.name()
        ):
            raise ValueError(
                f"An embedding function already exists in the collection configuration, and a new one is provided. If this is intentional, please embed documents separately. Embedding function conflict: new: {embedding_function.name()} vs persisted: {persisted_ef_config.get('name')}"
            )
    return None
