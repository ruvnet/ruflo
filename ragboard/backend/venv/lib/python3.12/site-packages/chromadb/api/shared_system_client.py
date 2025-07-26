from typing import ClassVar, Dict
import uuid

from chromadb.api import ServerAPI
from chromadb.config import Settings, System
from chromadb.telemetry.product import ProductTelemetryClient
from chromadb.telemetry.product.events import ClientStartEvent


class SharedSystemClient:
    _identifier_to_system: ClassVar[Dict[str, System]] = {}
    _identifier: str

    def __init__(
        self,
        settings: Settings = Settings(),
    ) -> None:
        self._identifier = SharedSystemClient._get_identifier_from_settings(settings)
        SharedSystemClient._create_system_if_not_exists(self._identifier, settings)

    @classmethod
    def _create_system_if_not_exists(
        cls, identifier: str, settings: Settings
    ) -> System:
        if identifier not in cls._identifier_to_system:
            new_system = System(settings)
            cls._identifier_to_system[identifier] = new_system

            new_system.instance(ProductTelemetryClient)
            new_system.instance(ServerAPI)

            new_system.start()
        else:
            previous_system = cls._identifier_to_system[identifier]

            # For now, the settings must match
            if previous_system.settings != settings:
                raise ValueError(
                    f"An instance of Chroma already exists for {identifier} with different settings"
                )

        return cls._identifier_to_system[identifier]

    @staticmethod
    def _get_identifier_from_settings(settings: Settings) -> str:
        identifier = ""
        api_impl = settings.chroma_api_impl

        if api_impl is None:
            raise ValueError("Chroma API implementation must be set in settings")
        elif api_impl in [
            "chromadb.api.segment.SegmentAPI",
            "chromadb.api.rust.RustBindingsAPI",
        ]:
            if settings.is_persistent:
                identifier = settings.persist_directory
            else:
                identifier = (
                    "ephemeral"  # TODO: support pathing and  multiple ephemeral clients
                )
        elif api_impl in [
            "chromadb.api.fastapi.FastAPI",
            "chromadb.api.async_fastapi.AsyncFastAPI",
        ]:
            # FastAPI clients can all use unique system identifiers since their configurations can be independent, e.g. different auth tokens
            identifier = str(uuid.uuid4())
        else:
            raise ValueError(f"Unsupported Chroma API implementation {api_impl}")

        return identifier

    @staticmethod
    def _populate_data_from_system(system: System) -> str:
        identifier = SharedSystemClient._get_identifier_from_settings(system.settings)
        SharedSystemClient._identifier_to_system[identifier] = system
        return identifier

    @classmethod
    def from_system(cls, system: System) -> "SharedSystemClient":
        """Create a client from an existing system. This is useful for testing and debugging."""

        SharedSystemClient._populate_data_from_system(system)
        instance = cls(system.settings)
        return instance

    @staticmethod
    def clear_system_cache() -> None:
        SharedSystemClient._identifier_to_system = {}

    @property
    def _system(self) -> System:
        return SharedSystemClient._identifier_to_system[self._identifier]

    def _submit_client_start_event(self) -> None:
        telemetry_client = self._system.instance(ProductTelemetryClient)
        telemetry_client.capture(ClientStartEvent())
