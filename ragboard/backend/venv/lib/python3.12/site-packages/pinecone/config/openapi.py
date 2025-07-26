import sys
from typing import List, Optional

import certifi
import socket

from urllib3.connection import HTTPConnection

from pinecone.core.client.configuration import Configuration as OpenApiConfiguration

TCP_KEEPINTVL = 60  # Sec
TCP_KEEPIDLE = 300  # Sec
TCP_KEEPCNT = 4


class OpenApiConfigFactory:
    @classmethod
    def build(cls, api_key: str, host: Optional[str] = None, **kwargs):
        openapi_config = OpenApiConfiguration()
        openapi_config.host = host
        openapi_config.ssl_ca_cert = certifi.where()
        openapi_config.socket_options = cls._get_socket_options()
        openapi_config.api_key = {"ApiKeyAuth": api_key}
        return openapi_config

    @classmethod
    def _get_socket_options(
        self,
        do_keep_alive: bool = True,
        keep_alive_idle_sec: int = TCP_KEEPIDLE,
        keep_alive_interval_sec: int = TCP_KEEPINTVL,
        keep_alive_tries: int = TCP_KEEPCNT,
    ) -> List[tuple]:
        """
        Returns the socket options to pass to OpenAPI's Rest client
        Args:
            do_keep_alive: Whether to enable TCP keep alive mechanism
            keep_alive_idle_sec: Time in seconds of connection idleness before starting to send keep alive probes
            keep_alive_interval_sec: Interval time in seconds between keep alive probe messages
            keep_alive_tries: Number of failed keep alive tries (unanswered KA messages) before terminating the connection

        Returns:
            A list of socket options for the Rest client's connection pool
        """
        # Source: https://www.finbourne.com/blog/the-mysterious-hanging-client-tcp-keep-alives

        socket_params = HTTPConnection.default_socket_options
        if not do_keep_alive:
            return socket_params

        socket_params += [(socket.SOL_SOCKET, socket.SO_KEEPALIVE, 1)]

        # TCP Keep Alive Probes for different platforms
        platform = sys.platform
        # TCP Keep Alive Probes for Linux
        if (
            platform == "linux"
            and hasattr(socket, "TCP_KEEPIDLE")
            and hasattr(socket, "TCP_KEEPINTVL")
            and hasattr(socket, "TCP_KEEPCNT")
        ):
            socket_params += [(socket.IPPROTO_TCP, socket.TCP_KEEPIDLE, keep_alive_idle_sec)]
            socket_params += [(socket.IPPROTO_TCP, socket.TCP_KEEPINTVL, keep_alive_interval_sec)]
            socket_params += [(socket.IPPROTO_TCP, socket.TCP_KEEPCNT, keep_alive_tries)]

        # TCP Keep Alive Probes for Windows OS
        # NOTE: Changing TCP KA params on windows is done via a different mechanism which OpenAPI's Rest client doesn't expose.
        # Since the default values work well, it seems setting `(socket.SO_KEEPALIVE, 1)` is sufficient.
        # Leaving this code here for future reference.
        # elif platform == 'win32' and hasattr(socket, "SIO_KEEPALIVE_VALS"):
        #     socket.ioctl((socket.SIO_KEEPALIVE_VALS, (1, keep_alive_idle_sec * 1000, keep_alive_interval_sec * 1000)))

        # TCP Keep Alive Probes for Mac OS
        elif platform == "darwin":
            TCP_KEEPALIVE = 0x10
            socket_params += [(socket.IPPROTO_TCP, TCP_KEEPALIVE, keep_alive_interval_sec)]

        return socket_params
