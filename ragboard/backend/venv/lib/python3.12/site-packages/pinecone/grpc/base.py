import logging
from abc import ABC, abstractmethod
from functools import wraps
from typing import Dict, Optional

import certifi
import grpc
from grpc._channel import _InactiveRpcError, Channel
import json

from .retry import RetryConfig

from pinecone import Config
from .utils import _generate_request_id
from .config import GRPCClientConfig
from pinecone.utils.constants import MAX_MSG_SIZE, REQUEST_ID, CLIENT_VERSION
from pinecone.exceptions import PineconeException

_logger = logging.getLogger(__name__)


class GRPCIndexBase(ABC):
    """
    Base class for grpc-based interaction with Pinecone indexes
    """

    _pool = None

    def __init__(
        self,
        index_name: str,
        config: Config,
        channel: Optional[Channel] = None,
        grpc_config: Optional[GRPCClientConfig] = None,
        _endpoint_override: Optional[str] = None,
    ):
        self.name = index_name

        self.config = config
        self.grpc_client_config = grpc_config or GRPCClientConfig()
        self.retry_config = self.grpc_client_config.retry_config or RetryConfig()
        self.fixed_metadata = {"api-key": config.api_key, "service-name": index_name, "client-version": CLIENT_VERSION}
        self._endpoint_override = _endpoint_override

        self.method_config = json.dumps(
            {
                "methodConfig": [
                    {
                        "name": [{"service": "VectorService.Upsert"}],
                        "retryPolicy": {
                            "maxAttempts": 5,
                            "initialBackoff": "0.1s",
                            "maxBackoff": "1s",
                            "backoffMultiplier": 2,
                            "retryableStatusCodes": ["UNAVAILABLE"],
                        },
                    },
                    {
                        "name": [{"service": "VectorService"}],
                        "retryPolicy": {
                            "maxAttempts": 5,
                            "initialBackoff": "0.1s",
                            "maxBackoff": "1s",
                            "backoffMultiplier": 2,
                            "retryableStatusCodes": ["UNAVAILABLE"],
                        },
                    },
                ]
            }
        )

        self._channel = channel or self._gen_channel()
        self.stub = self.stub_class(self._channel)

    @property
    @abstractmethod
    def stub_class(self):
        pass

    def _endpoint(self):
        grpcHost = self.config.host.replace("https://", "")
        return self._endpoint_override if self._endpoint_override else f"{grpcHost}:443"

    def _gen_channel(self, options=None):
        target = self._endpoint()
        default_options = {
            "grpc.max_send_message_length": MAX_MSG_SIZE,
            "grpc.max_receive_message_length": MAX_MSG_SIZE,
            "grpc.service_config": self.method_config,
            "grpc.enable_retries": True,
        }
        if self.grpc_client_config.secure:
            default_options["grpc.ssl_target_name_override"] = target.split(":")[0]
        user_provided_options = options or {}
        _options = tuple((k, v) for k, v in {**default_options, **user_provided_options}.items())
        _logger.debug(
            "creating new channel with endpoint %s options %s and config %s", target, _options, self.grpc_client_config
        )
        if not self.grpc_client_config.secure:
            channel = grpc.insecure_channel(target, options=_options)
        else:
            root_cas = open(certifi.where(), "rb").read()
            tls = grpc.ssl_channel_credentials(root_certificates=root_cas)
            channel = grpc.secure_channel(target, tls, options=_options)

        return channel

    @property
    def channel(self):
        """Creates GRPC channel."""
        if self.grpc_client_config.reuse_channel and self._channel and self.grpc_server_on():
            return self._channel
        self._channel = self._gen_channel()
        return self._channel

    def grpc_server_on(self) -> bool:
        try:
            grpc.channel_ready_future(self._channel).result(timeout=self.grpc_client_config.conn_timeout)
            return True
        except grpc.FutureTimeoutError:
            return False

    def close(self):
        """Closes the connection to the index."""
        try:
            self._channel.close()
        except TypeError:
            pass

    def _wrap_grpc_call(
        self, func, request, timeout=None, metadata=None, credentials=None, wait_for_ready=None, compression=None
    ):
        @wraps(func)
        def wrapped():
            user_provided_metadata = metadata or {}
            _metadata = tuple(
                (k, v) for k, v in {**self.fixed_metadata, **self._request_metadata(), **user_provided_metadata}.items()
            )
            try:
                return func(
                    request,
                    timeout=timeout,
                    metadata=_metadata,
                    credentials=credentials,
                    wait_for_ready=wait_for_ready,
                    compression=compression,
                )
            except _InactiveRpcError as e:
                raise PineconeException(e._state.debug_error_string) from e

        return wrapped()

    def _request_metadata(self) -> Dict[str, str]:
        return {REQUEST_ID: _generate_request_id()}

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        self.close()
