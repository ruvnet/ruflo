from typing import Optional, Union
from urllib.parse import urlparse

import dns.asyncbackend
import dns.asyncquery
import dns.inet
import dns.message
import dns.query


class Nameserver:
    def __init__(self):
        pass

    def __str__(self):
        raise NotImplementedError

    def kind(self) -> str:
        raise NotImplementedError

    def is_always_max_size(self) -> bool:
        raise NotImplementedError

    def answer_nameserver(self) -> str:
        raise NotImplementedError

    def answer_port(self) -> int:
        raise NotImplementedError

    def query(
        self,
        request: dns.message.QueryMessage,
        timeout: float,
        source: Optional[str],
        source_port: int,
        max_size: bool,
        one_rr_per_rrset: bool = False,
        ignore_trailing: bool = False,
    ) -> dns.message.Message:
        raise NotImplementedError

    async def async_query(
        self,
        request: dns.message.QueryMessage,
        timeout: float,
        source: Optional[str],
        source_port: int,
        max_size: bool,
        backend: dns.asyncbackend.Backend,
        one_rr_per_rrset: bool = False,
        ignore_trailing: bool = False,
    ) -> dns.message.Message:
        raise NotImplementedError


class AddressAndPortNameserver(Nameserver):
    def __init__(self, address: str, port: int):
        super().__init__()
        self.address = address
        self.port = port

    def kind(self) -> str:
        raise NotImplementedError

    def is_always_max_size(self) -> bool:
        return False

    def __str__(self):
        ns_kind = self.kind()
        return f"{ns_kind}:{self.address}@{self.port}"

    def answer_nameserver(self) -> str:
        return self.address

    def answer_port(self) -> int:
        return self.port


class Do53Nameserver(AddressAndPortNameserver):
    def __init__(self, address: str, port: int = 53):
        super().__init__(address, port)

    def kind(self):
        return "Do53"

    def query(
        self,
        request: dns.message.QueryMessage,
        timeout: float,
        source: Optional[str],
        source_port: int,
        max_size: bool,
        one_rr_per_rrset: bool = False,
        ignore_trailing: bool = False,
    ) -> dns.message.Message:
        if max_size:
            response = dns.query.tcp(
                request,
                self.address,
                timeout=timeout,
                port=self.port,
                source=source,
                source_port=source_port,
                one_rr_per_rrset=one_rr_per_rrset,
                ignore_trailing=ignore_trailing,
            )
        else:
            response = dns.query.udp(
                request,
                self.address,
                timeout=timeout,
                port=self.port,
                source=source,
                source_port=source_port,
                raise_on_truncation=True,
                one_rr_per_rrset=one_rr_per_rrset,
                ignore_trailing=ignore_trailing,
                ignore_errors=True,
                ignore_unexpected=True,
            )
        return response

    async def async_query(
        self,
        request: dns.message.QueryMessage,
        timeout: float,
        source: Optional[str],
        source_port: int,
        max_size: bool,
        backend: dns.asyncbackend.Backend,
        one_rr_per_rrset: bool = False,
        ignore_trailing: bool = False,
    ) -> dns.message.Message:
        if max_size:
            response = await dns.asyncquery.tcp(
                request,
                self.address,
                timeout=timeout,
                port=self.port,
                source=source,
                source_port=source_port,
                backend=backend,
                one_rr_per_rrset=one_rr_per_rrset,
                ignore_trailing=ignore_trailing,
            )
        else:
            response = await dns.asyncquery.udp(
                request,
                self.address,
                timeout=timeout,
                port=self.port,
                source=source,
                source_port=source_port,
                raise_on_truncation=True,
                backend=backend,
                one_rr_per_rrset=one_rr_per_rrset,
                ignore_trailing=ignore_trailing,
                ignore_errors=True,
                ignore_unexpected=True,
            )
        return response


class DoHNameserver(Nameserver):
    def __init__(
        self,
        url: str,
        bootstrap_address: Optional[str] = None,
        verify: Union[bool, str] = True,
        want_get: bool = False,
        http_version: dns.query.HTTPVersion = dns.query.HTTPVersion.DEFAULT,
    ):
        super().__init__()
        self.url = url
        self.bootstrap_address = bootstrap_address
        self.verify = verify
        self.want_get = want_get
        self.http_version = http_version

    def kind(self):
        return "DoH"

    def is_always_max_size(self) -> bool:
        return True

    def __str__(self):
        return self.url

    def answer_nameserver(self) -> str:
        return self.url

    def answer_port(self) -> int:
        port = urlparse(self.url).port
        if port is None:
            port = 443
        return port

    def query(
        self,
        request: dns.message.QueryMessage,
        timeout: float,
        source: Optional[str],
        source_port: int,
        max_size: bool = False,
        one_rr_per_rrset: bool = False,
        ignore_trailing: bool = False,
    ) -> dns.message.Message:
        return dns.query.https(
            request,
            self.url,
            timeout=timeout,
            source=source,
            source_port=source_port,
            bootstrap_address=self.bootstrap_address,
            one_rr_per_rrset=one_rr_per_rrset,
            ignore_trailing=ignore_trailing,
            verify=self.verify,
            post=(not self.want_get),
            http_version=self.http_version,
        )

    async def async_query(
        self,
        request: dns.message.QueryMessage,
        timeout: float,
        source: Optional[str],
        source_port: int,
        max_size: bool,
        backend: dns.asyncbackend.Backend,
        one_rr_per_rrset: bool = False,
        ignore_trailing: bool = False,
    ) -> dns.message.Message:
        return await dns.asyncquery.https(
            request,
            self.url,
            timeout=timeout,
            source=source,
            source_port=source_port,
            bootstrap_address=self.bootstrap_address,
            one_rr_per_rrset=one_rr_per_rrset,
            ignore_trailing=ignore_trailing,
            verify=self.verify,
            post=(not self.want_get),
            http_version=self.http_version,
        )


class DoTNameserver(AddressAndPortNameserver):
    def __init__(
        self,
        address: str,
        port: int = 853,
        hostname: Optional[str] = None,
        verify: Union[bool, str] = True,
    ):
        super().__init__(address, port)
        self.hostname = hostname
        self.verify = verify

    def kind(self):
        return "DoT"

    def query(
        self,
        request: dns.message.QueryMessage,
        timeout: float,
        source: Optional[str],
        source_port: int,
        max_size: bool = False,
        one_rr_per_rrset: bool = False,
        ignore_trailing: bool = False,
    ) -> dns.message.Message:
        return dns.query.tls(
            request,
            self.address,
            port=self.port,
            timeout=timeout,
            one_rr_per_rrset=one_rr_per_rrset,
            ignore_trailing=ignore_trailing,
            server_hostname=self.hostname,
            verify=self.verify,
        )

    async def async_query(
        self,
        request: dns.message.QueryMessage,
        timeout: float,
        source: Optional[str],
        source_port: int,
        max_size: bool,
        backend: dns.asyncbackend.Backend,
        one_rr_per_rrset: bool = False,
        ignore_trailing: bool = False,
    ) -> dns.message.Message:
        return await dns.asyncquery.tls(
            request,
            self.address,
            port=self.port,
            timeout=timeout,
            one_rr_per_rrset=one_rr_per_rrset,
            ignore_trailing=ignore_trailing,
            server_hostname=self.hostname,
            verify=self.verify,
        )


class DoQNameserver(AddressAndPortNameserver):
    def __init__(
        self,
        address: str,
        port: int = 853,
        verify: Union[bool, str] = True,
        server_hostname: Optional[str] = None,
    ):
        super().__init__(address, port)
        self.verify = verify
        self.server_hostname = server_hostname

    def kind(self):
        return "DoQ"

    def query(
        self,
        request: dns.message.QueryMessage,
        timeout: float,
        source: Optional[str],
        source_port: int,
        max_size: bool = False,
        one_rr_per_rrset: bool = False,
        ignore_trailing: bool = False,
    ) -> dns.message.Message:
        return dns.query.quic(
            request,
            self.address,
            port=self.port,
            timeout=timeout,
            one_rr_per_rrset=one_rr_per_rrset,
            ignore_trailing=ignore_trailing,
            verify=self.verify,
            server_hostname=self.server_hostname,
        )

    async def async_query(
        self,
        request: dns.message.QueryMessage,
        timeout: float,
        source: Optional[str],
        source_port: int,
        max_size: bool,
        backend: dns.asyncbackend.Backend,
        one_rr_per_rrset: bool = False,
        ignore_trailing: bool = False,
    ) -> dns.message.Message:
        return await dns.asyncquery.quic(
            request,
            self.address,
            port=self.port,
            timeout=timeout,
            one_rr_per_rrset=one_rr_per_rrset,
            ignore_trailing=ignore_trailing,
            verify=self.verify,
            server_hostname=self.server_hostname,
        )
