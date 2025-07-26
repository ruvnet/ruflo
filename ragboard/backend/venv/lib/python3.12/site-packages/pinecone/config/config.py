from typing import NamedTuple, Optional, Dict
import os

from pinecone.exceptions import PineconeConfigurationError
from pinecone.config.openapi import OpenApiConfigFactory
from pinecone.core.client.configuration import Configuration as OpenApiConfiguration
from pinecone.utils import normalize_host

class Config(NamedTuple):
    api_key: str = ""
    host: str = ""
    openapi_config: Optional[OpenApiConfiguration] = None
    additional_headers: Optional[Dict[str, str]] = {}

class ConfigBuilder:
    """

    Configurations are resolved in the following order:

    - configs passed as keyword parameters
    - configs specified in environment variables
    - default values (if applicable)
    """

    """Initializes the Pinecone client.

    :param api_key: Required if not set in config file or by environment variable ``PINECONE_API_KEY``.
    :param host: Optional. Controller host.
    :param openapi_config: Optional. Set OpenAPI client configuration.
    """

    @staticmethod
    def build(
        api_key: Optional[str] = None,
        host: Optional[str] = None,
        openapi_config: Optional[OpenApiConfiguration] = None,
        additional_headers: Optional[Dict[str, str]] = {},
        **kwargs,
    ) -> Config:
        api_key = api_key or kwargs.pop("api_key", None) or os.getenv("PINECONE_API_KEY")
        host = host or kwargs.pop("host", None)
        host = normalize_host(host)

        if not api_key:
            raise PineconeConfigurationError("You haven't specified an Api-Key.")
        if not host:
            raise PineconeConfigurationError("You haven't specified a host.")

        openapi_config = (
            openapi_config
            or kwargs.pop("openapi_config", None)
            or OpenApiConfigFactory.build(api_key=api_key, host=host)
        )

        return Config(api_key, host, openapi_config, additional_headers)