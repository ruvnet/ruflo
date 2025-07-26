from __future__ import annotations

from collections import deque
from io import BytesIO

import urllib3

from kombu.asynchronous.hub import Hub, get_event_loop
from kombu.exceptions import HttpError

from .base import BaseClient, Request

__all__ = ('Urllib3Client',)

from ...utils.encoding import bytes_to_str

DEFAULT_USER_AGENT = 'Mozilla/5.0 (compatible; urllib3)'
EXTRA_METHODS = frozenset(['DELETE', 'OPTIONS', 'PATCH'])


def _get_pool_key_parts(request: Request) -> list[str]:
    _pool_key_parts = []

    if request.network_interface:
        _pool_key_parts.append(f"interface={request.network_interface}")

    if request.validate_cert:
        _pool_key_parts.append("validate_cert=True")
    else:
        _pool_key_parts.append("validate_cert=False")

    if request.ca_certs:
        _pool_key_parts.append(f"ca_certs={request.ca_certs}")

    if request.client_cert:
        _pool_key_parts.append(f"client_cert={request.client_cert}")

    if request.client_key:
        _pool_key_parts.append(f"client_key={request.client_key}")

    return _pool_key_parts


class Urllib3Client(BaseClient):
    """Urllib3 HTTP Client."""

    _pools = {}

    def __init__(self, hub: Hub | None = None, max_clients: int = 10):
        hub = hub or get_event_loop()
        super().__init__(hub)
        self.max_clients = max_clients
        self._pending = deque()
        self._timeout_check_tref = self.hub.call_repeatedly(
            1.0, self._timeout_check,
        )

    def pools_close(self):
        for pool in self._pools.values():
            pool.close()
        self._pools.clear()

    def close(self):
        self._timeout_check_tref.cancel()
        self.pools_close()

    def add_request(self, request):
        self._pending.append(request)
        self._process_queue()
        return request

    def get_pool(self, request: Request):
        _pool_key_parts = _get_pool_key_parts(request=request)

        _proxy_url = None
        proxy_headers = None
        if request.proxy_host:
            _proxy_url = urllib3.util.Url(
                scheme=None,
                host=request.proxy_host,
                port=request.proxy_port,
            )
            if request.proxy_username:
                proxy_headers = urllib3.make_headers(
                    proxy_basic_auth=(
                        f"{request.proxy_username}"
                        f":{request.proxy_password}"
                    )
                )
            else:
                proxy_headers = None

            _proxy_url = _proxy_url.url

            _pool_key_parts.append(f"proxy={_proxy_url}")
            if proxy_headers:
                _pool_key_parts.append(f"proxy_headers={str(proxy_headers)}")

        _pool_key = "|".join(_pool_key_parts)
        if _pool_key in self._pools:
            return self._pools[_pool_key]

        # create new pool
        if _proxy_url:
            _pool = urllib3.ProxyManager(
                proxy_url=_proxy_url,
                num_pools=self.max_clients,
                proxy_headers=proxy_headers
            )
        else:
            _pool = urllib3.PoolManager(num_pools=self.max_clients)

        # Network Interface
        if request.network_interface:
            _pool.connection_pool_kw['source_address'] = (
                request.network_interface,
                0
            )

        # SSL Verification
        if request.validate_cert:
            _pool.connection_pool_kw['cert_reqs'] = 'CERT_REQUIRED'
        else:
            _pool.connection_pool_kw['cert_reqs'] = 'CERT_NONE'

        # CA Certificates
        if request.ca_certs is not None:
            _pool.connection_pool_kw['ca_certs'] = request.ca_certs
        elif request.validate_cert is True:
            try:
                from certifi import where
                _pool.connection_pool_kw['ca_certs'] = where()
            except ImportError:
                pass

        # Client Certificates
        if request.client_cert is not None:
            _pool.connection_pool_kw['cert_file'] = request.client_cert
        if request.client_key is not None:
            _pool.connection_pool_kw['key_file'] = request.client_key

        self._pools[_pool_key] = _pool

        return _pool

    def _timeout_check(self):
        self._process_pending_requests()

    def _process_pending_requests(self):
        while self._pending:
            request = self._pending.popleft()
            self._process_request(request)

    def _process_request(self, request: Request):
        # Prepare headers
        headers = request.headers
        headers.setdefault(
            'User-Agent',
            bytes_to_str(request.user_agent or DEFAULT_USER_AGENT)
        )
        headers.setdefault(
            'Accept-Encoding',
            'gzip,deflate' if request.use_gzip else 'none'
        )

        # Authentication
        if request.auth_username is not None:
            headers.update(
                urllib3.util.make_headers(
                    basic_auth=(
                        f"{request.auth_username}"
                        f":{request.auth_password or ''}"
                    )
                )
            )

        # Make the request using urllib3
        try:
            _pool = self.get_pool(request=request)
            response = _pool.request(
                request.method,
                request.url,
                headers=headers,
                body=request.body,
                preload_content=False,
                redirect=request.follow_redirects,
            )
            buffer = BytesIO(response.data)
            response_obj = self.Response(
                request=request,
                code=response.status,
                headers=response.headers,
                buffer=buffer,
                effective_url=response.geturl(),
                error=None
            )
        except urllib3.exceptions.HTTPError as e:
            response_obj = self.Response(
                request=request,
                code=599,
                headers={},
                buffer=None,
                effective_url=None,
                error=HttpError(599, str(e))
            )

        request.on_ready(response_obj)

    def _process_queue(self):
        self._process_pending_requests()

    def on_readable(self, fd):
        pass

    def on_writable(self, fd):
        pass

    def _setup_request(self, curl, request, buffer, headers):
        pass
