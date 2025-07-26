from abc import abstractmethod
import json
from overrides import override
from typing import (
    Any,
    ClassVar,
    Dict,
    List,
    Optional,
    Protocol,
    Union,
    TypeVar,
    cast,
)
from typing_extensions import Self
from multiprocessing import cpu_count

from chromadb.serde import JSONSerializable

# TODO: move out of API


class StaticParameterError(Exception):
    """Represents an error that occurs when a static parameter is set."""

    pass


class InvalidConfigurationError(ValueError):
    """Represents an error that occurs when a configuration is invalid."""

    pass


ParameterValue = Union[str, int, float, bool, "ConfigurationInternal"]


class ParameterValidator(Protocol):
    """Represents an abstract parameter validator."""

    @abstractmethod
    def __call__(self, value: ParameterValue) -> bool:
        """Returns whether the given value is valid."""
        raise NotImplementedError()


class ConfigurationDefinition:
    """Represents the definition of a configuration."""

    name: str
    validator: ParameterValidator
    is_static: bool
    default_value: ParameterValue

    def __init__(
        self,
        name: str,
        validator: ParameterValidator,
        is_static: bool,
        default_value: ParameterValue,
    ):
        self.name = name
        self.validator = validator
        self.is_static = is_static
        self.default_value = default_value


class ConfigurationParameter:
    """Represents a parameter of a configuration."""

    name: str
    value: ParameterValue

    def __init__(self, name: str, value: ParameterValue):
        self.name = name
        self.value = value

    def __repr__(self) -> str:
        return f"ConfigurationParameter({self.name}, {self.value})"

    def __eq__(self, __value: object) -> bool:
        if not isinstance(__value, ConfigurationParameter):
            return NotImplemented
        return self.name == __value.name and self.value == __value.value


T = TypeVar("T", bound="ConfigurationInternal")


class ConfigurationInternal(JSONSerializable["ConfigurationInternal"]):
    """Represents an abstract configuration, used internally by Chroma."""

    # The internal data structure used to store the parameters
    # All expected parameters must be present with defaults or None values at initialization
    parameter_map: Dict[str, ConfigurationParameter]
    definitions: ClassVar[Dict[str, ConfigurationDefinition]]

    def __init__(self, parameters: Optional[List[ConfigurationParameter]] = None):
        """Initializes a new instance of the Configuration class. Respecting defaults and
        validators."""
        self.parameter_map = {}
        if parameters is not None:
            for parameter in parameters:
                if parameter.name not in self.definitions:
                    raise ValueError(f"Invalid parameter name: {parameter.name}")

                definition = self.definitions[parameter.name]
                # Handle the case where we have a recursive configuration definition
                if isinstance(parameter.value, dict):
                    child_type = globals().get(parameter.value.get("_type", None))
                    if child_type is None:
                        raise ValueError(
                            f"Invalid configuration type: {parameter.value}"
                        )
                    parameter.value = child_type.from_json(parameter.value)
                if not isinstance(parameter.value, type(definition.default_value)):
                    raise ValueError(f"Invalid parameter value: {parameter.value}")

                parameter_validator = definition.validator
                if not parameter_validator(parameter.value):
                    raise ValueError(f"Invalid parameter value: {parameter.value}")
                self.parameter_map[parameter.name] = parameter
        # Apply the defaults for any missing parameters
        for name, definition in self.definitions.items():
            if name not in self.parameter_map:
                self.parameter_map[name] = ConfigurationParameter(
                    name=name, value=definition.default_value
                )

        self.configuration_validator()

    def __repr__(self) -> str:
        return f"Configuration({self.parameter_map.values()})"

    def __eq__(self, __value: object) -> bool:
        if not isinstance(__value, ConfigurationInternal):
            return NotImplemented
        return self.parameter_map == __value.parameter_map

    @abstractmethod
    def configuration_validator(self) -> None:
        """Perform custom validation when parameters are dependent on each other.

        Raises an InvalidConfigurationError if the configuration is invalid.
        """
        pass

    def get_parameters(self) -> List[ConfigurationParameter]:
        """Returns the parameters of the configuration."""
        return list(self.parameter_map.values())

    def get_parameter(self, name: str) -> ConfigurationParameter:
        """Returns the parameter with the given name, or except if it doesn't exist."""
        if name not in self.parameter_map:
            raise ValueError(
                f"Invalid parameter name: {name} for configuration {self.__class__.__name__}"
            )
        param_value = cast(ConfigurationParameter, self.parameter_map.get(name))
        return param_value

    def set_parameter(self, name: str, value: Union[str, int, float, bool]) -> None:
        """Sets the parameter with the given name to the given value."""
        if name not in self.definitions:
            raise ValueError(f"Invalid parameter name: {name}")
        definition = self.definitions[name]
        parameter = self.parameter_map[name]
        if definition.is_static:
            raise StaticParameterError(f"Cannot set static parameter: {name}")
        if not definition.validator(value):
            raise ValueError(f"Invalid value for parameter {name}: {value}")
        parameter.value = value

    @override
    def to_json_str(self) -> str:
        """Returns the JSON representation of the configuration."""
        return json.dumps(self.to_json())

    @classmethod
    @override
    def from_json_str(cls, json_str: str) -> Self:
        """Returns a configuration from the given JSON string."""
        try:
            config_json = json.loads(json_str)
        except json.JSONDecodeError:
            raise ValueError(
                f"Unable to decode configuration from JSON string: {json_str}"
            )
        return cls.from_json(config_json) if config_json else cls()

    @override
    def to_json(self) -> Dict[str, Any]:
        """Returns the JSON compatible dictionary representation of the configuration."""
        json_dict = {
            name: parameter.value.to_json()
            if isinstance(parameter.value, ConfigurationInternal)
            else parameter.value
            for name, parameter in self.parameter_map.items()
        }
        # What kind of configuration is this?
        json_dict["_type"] = self.__class__.__name__
        return json_dict

    @classmethod
    @override
    def from_json(cls, json_map: Dict[str, Any]) -> Self:
        """Returns a configuration from the given JSON string."""
        if cls.__name__ != json_map.get("_type", None):
            raise ValueError(
                f"Trying to instantiate configuration of type {cls.__name__} from JSON with type {json_map['_type']}"
            )
        parameters = []
        for name, value in json_map.items():
            # Type value is only for storage
            if name == "_type":
                continue
            parameters.append(ConfigurationParameter(name=name, value=value))
        return cls(parameters=parameters)


class HNSWConfigurationInternal(ConfigurationInternal):
    """Internal representation of the HNSW configuration.
    Used for validation, defaults, serialization and deserialization."""

    definitions = {
        "space": ConfigurationDefinition(
            name="space",
            validator=lambda value: isinstance(value, str)
            and value in ["l2", "ip", "cosine"],
            is_static=True,
            default_value="l2",
        ),
        "ef_construction": ConfigurationDefinition(
            name="ef_construction",
            validator=lambda value: isinstance(value, int) and value >= 1,
            is_static=True,
            default_value=100,
        ),
        "ef_search": ConfigurationDefinition(
            name="ef_search",
            validator=lambda value: isinstance(value, int) and value >= 1,
            is_static=False,
            default_value=100,
        ),
        "num_threads": ConfigurationDefinition(
            name="num_threads",
            validator=lambda value: isinstance(value, int) and value >= 1,
            is_static=False,
            default_value=cpu_count(),  # By default use all cores available
        ),
        "M": ConfigurationDefinition(
            name="M",
            validator=lambda value: isinstance(value, int) and value >= 1,
            is_static=True,
            default_value=16,
        ),
        "resize_factor": ConfigurationDefinition(
            name="resize_factor",
            validator=lambda value: isinstance(value, float) and value >= 1,
            is_static=True,
            default_value=1.2,
        ),
        "batch_size": ConfigurationDefinition(
            name="batch_size",
            validator=lambda value: isinstance(value, int) and value >= 1,
            is_static=True,
            default_value=100,
        ),
        "sync_threshold": ConfigurationDefinition(
            name="sync_threshold",
            validator=lambda value: isinstance(value, int) and value >= 1,
            is_static=True,
            default_value=1000,
        ),
    }

    @override
    def configuration_validator(self) -> None:
        batch_size = self.parameter_map.get("batch_size")
        sync_threshold = self.parameter_map.get("sync_threshold")

        if (
            batch_size
            and sync_threshold
            and cast(int, batch_size.value) > cast(int, sync_threshold.value)
        ):
            raise InvalidConfigurationError(
                "batch_size must be less than or equal to sync_threshold"
            )

    @classmethod
    def from_legacy_params(cls, params: Dict[str, Any]) -> Self:
        """Returns an HNSWConfiguration from a metadata dict containing legacy HNSW parameters. Used for migration."""

        # We maintain this map to avoid a circular import with HnswParams, and
        # because then names won't change since we intend to deprecate HNSWParams
        # in favor of this type of configuration.
        old_to_new = {
            "hnsw:space": "space",
            "hnsw:construction_ef": "ef_construction",
            "hnsw:search_ef": "ef_search",
            "hnsw:M": "M",
            "hnsw:num_threads": "num_threads",
            "hnsw:resize_factor": "resize_factor",
            "hnsw:batch_size": "batch_size",
            "hnsw:sync_threshold": "sync_threshold",
        }

        parameters = []
        for name, value in params.items():
            if name not in old_to_new:
                raise ValueError(f"Invalid legacy HNSW parameter name: {name}")
            parameters.append(
                ConfigurationParameter(name=old_to_new[name], value=value)
            )
        return cls(parameters)


# This is the user-facing interface for HNSW index configuration parameters.
# Internally, we pass around HNSWConfigurationInternal objects, which perform
# validation, serialization and deserialization. Users don't need to know
# about that and instead get a clean constructor with default arguments.
class HNSWConfigurationInterface(HNSWConfigurationInternal):
    """HNSW index configuration parameters.
    See https://docs.trychroma.com/guides#changing-the-distance-function for more information.
    """

    def __init__(
        self,
        space: str = "l2",
        ef_construction: int = 100,
        ef_search: int = 100,
        num_threads: int = cpu_count(),
        M: int = 16,
        resize_factor: float = 1.2,
        batch_size: int = 100,
        sync_threshold: int = 1000,
    ):
        parameters = [
            ConfigurationParameter(name="space", value=space),
            ConfigurationParameter(name="ef_construction", value=ef_construction),
            ConfigurationParameter(name="ef_search", value=ef_search),
            ConfigurationParameter(name="num_threads", value=num_threads),
            ConfigurationParameter(name="M", value=M),
            ConfigurationParameter(name="resize_factor", value=resize_factor),
            ConfigurationParameter(name="batch_size", value=batch_size),
            ConfigurationParameter(name="sync_threshold", value=sync_threshold),
        ]

        super().__init__(parameters=parameters)


# Alias for user convenience - the user doesn't need to know this is an 'Interface'
HNSWConfiguration = HNSWConfigurationInterface


class CollectionConfigurationInternal(ConfigurationInternal):
    """Internal representation of the collection configuration.
    Used for validation, defaults, and serialization / deserialization."""

    definitions = {
        "hnsw_configuration": ConfigurationDefinition(
            name="hnsw_configuration",
            validator=lambda value: isinstance(value, HNSWConfigurationInternal),
            is_static=True,
            default_value=HNSWConfigurationInternal(),
        ),
    }

    @override
    def configuration_validator(self) -> None:
        pass


# This is the user-facing interface for HNSW index configuration parameters.
# Internally, we pass around HNSWConfigurationInternal objects, which perform
# validation, serialization and deserialization. Users don't need to know
# about that and instead get a clean constructor with default arguments.
class CollectionConfigurationInterface(CollectionConfigurationInternal):
    """Configuration parameters for creating a collection."""

    def __init__(self, hnsw_configuration: Optional[HNSWConfigurationInternal]):
        """Initializes a new instance of the CollectionConfiguration class.
        Args:
            hnsw_configuration: The HNSW configuration to use for the collection.
        """
        if hnsw_configuration is None:
            hnsw_configuration = HNSWConfigurationInternal()
        parameters = [
            ConfigurationParameter(name="hnsw_configuration", value=hnsw_configuration)
        ]
        super().__init__(parameters=parameters)


# Alias for user convenience - the user doesn't need to know this is an 'Interface'.
CollectionConfiguration = CollectionConfigurationInterface


class EmbeddingsQueueConfigurationInternal(ConfigurationInternal):
    definitions = {
        "automatically_purge": ConfigurationDefinition(
            name="automatically_purge",
            validator=lambda value: isinstance(value, bool),
            is_static=False,
            default_value=True,
        ),
    }

    @override
    def configuration_validator(self) -> None:
        pass
