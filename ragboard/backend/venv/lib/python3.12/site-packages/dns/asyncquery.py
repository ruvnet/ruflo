# Copyright (C) Dnspython Contributors, see LICENSE for text of ISC license

# Copyright (C) 2003-2017 Nominum, Inc.
#
# Permission to use, copy, modify, and distribute this software and its
# documentation for any purpose with or without fee is hereby granted,
# provided that the above copyright notice and this permission notice
# appear in all copies.
#
# THE SOFTWARE IS PROVIDED "AS IS" AND NOMINUM DISCLAIMS ALL WARRANTIES
# WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
# MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL NOMINUM BE LIABLE FOR
# ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
# WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
# ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT
# OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.

"""Talk to a DNS server."""

import base64
import contextlib
import random
import socket
import struct
import time
import urllib.parse
from typing import Any, Dict, Optional, Tuple, Union, cast

import dns.asyncbackend
import dns.exception
import dns.inet
import dns.message
import dns.name
import dns.quic
import dns.rcode
import dns.rdataclass
import dns.rdatatype
import dns.transaction
from dns._asyncbackend import NullContext
from dns.query import (
    BadResponse,
    HTTPVersion,
    NoDOH,
    NoDOQ,
    UDPMode,
    _check_status,
    _compute_times,
    _make_dot_ssl_context,
    _matches_destination,
    _remaining,
    have_doh,
    ssl,
)

if have_doh:
    import httpx

# for brevity
_lltuple = dns.inet.low_level_address_tuple


def _source_tuple(af, address, port):
    # Make a high level source tuple, or return None if address and port
    # are both None
    if address or port:
        if address is None:
            if af == socket.AF_INET:
                address = "0.0.0.0"
            elif af == socket.AF_INET6:
                address = "::"
            else:
                raise NotImplementedError(f"unknown address family {af}")
        return (address, port)
    else:
        return None


def _timeout(expiration, now=None):
    if expiration is not None:
        if not now:
            now = time.time()
        return max(expiration - now, 0)
    else:
        return None


async def send_udp(
    sock: dns.asyncbackend.DatagramSocket,
    what: Union[dns.message.Message, bytes],
    destination: Any,
    expiration: Optional[float] = None,
) -> Tuple[int, float]:
    """Send a DNS message to the specified UDP socket.

    *sock*, a ``dns.asyncbackend.DatagramSocket``.

    *what*, a ``bytes`` or ``dns.message.Message``, the message to send.

    *destination*, a destination tuple appropriate for the address family
    of the socket, specifying where to send the query.

    *expiration*, a ``float`` or ``None``, the absolute time at which
    a timeout exception should be raised.  If ``None``, no timeout will
    occur.  The expiration value is meaningless for the asyncio backend, as
    asyncio's transport sendto() never blocks.

    Returns an ``(int, float)`` tuple of bytes sent and the sent time.
    """

    if isinstance(what, dns.message.Message):
        what = what.to_wire()
    sent_time = time.time()
    n = await sock.sendto(what, destination, _timeout(expiration, sent_time))
    return (n, sent_time)


async def receive_udp(
    sock: dns.asyncbackend.DatagramSocket,
    destination: Optional[Any] = None,
    expiration: Optional[float] = None,
    ignore_unexpected: bool = False,
    one_rr_per_rrset: bool = False,
    keyring: Optional[Dict[dns.name.Name, dns.tsig.Key]] = None,
    request_mac: Optional[bytes] = b"",
    ignore_trailing: bool = False,
    raise_on_truncation: bool = False,
    ignore_errors: bool = False,
    query: Optional[dns.message.Message] = None,
) -> Any:
    """Read a DNS message from a UDP socket.

    *sock*, a ``dns.asyncbackend.DatagramSocket``.

    See :py:func:`dns.query.receive_udp()` for the documentation of the other
    parameters, and exceptions.

    Returns a ``(dns.message.Message, float, tuple)`` tuple of the received message, the
    received time, and the address where the message arrived from.
    """

    wire = b""
    while True:
        (wire, from_address) = await sock.recvfrom(65535, _timeout(expiration))
        if not _matches_destination(
            sock.family, from_address, destination, ignore_unexpected
        ):
            continue
        received_time = time.time()
        try:
            r = dns.message.from_wire(
                wire,
                keyring=keyring,
                request_mac=request_mac,
                one_rr_per_rrset=one_rr_per_rrset,
                ignore_trailing=ignore_trailing,
                raise_on_truncation=raise_on_truncation,
            )
        except dns.message.Truncated as e:
            # See the comment in query.py for details.
            if (
                ignore_errors
                and query is not None
                and not query.is_response(e.message())
            ):
                continue
            else:
                raise
        except Exception:
            if ignore_errors:
                continue
            else:
                raise
        if ignore_errors and query is not None and not query.is_response(r):
            continue
        return (r, received_time, from_address)


async def udp(
    q: dns.message.Message,
    where: str,
    timeout: Optional[float] = None,
    port: int = 53,
    source: Optional[str] = None,
    source_port: int = 0,
    ignore_unexpected: bool = False,
    one_rr_per_rrset: bool = False,
    ignore_trailing: bool = False,
    raise_on_truncation: bool = False,
    sock: Optional[dns.asyncbackend.DatagramSocket] = None,
    backend: Optional[dns.asyncbackend.Backend] = None,
    ignore_errors: bool = False,
) -> dns.message.Message:
    """Return the response obtained after sending a query via UDP.

    *sock*, a ``dns.asyncbackend.DatagramSocket``, or ``None``,
    the socket to use for the query.  If ``None``, the default, a
    socket is created.  Note that if a socket is provided, the
    *source*, *source_port*, and *backend* are ignored.

    *backend*, a ``dns.asyncbackend.Backend``, or ``None``.  If ``None``,
    the default, then dnspython will use the default backend.

    See :py:func:`dns.query.udp()` for the documentation of the other
    parameters, exceptions, and return type of this method.
    """
    wire = q.to_wire()
    (begin_time, expiration) = _compute_times(timeout)
    af = dns.inet.af_for_address(where)
    destination = _lltuple((where, port), af)
    if sock:
        cm: contextlib.AbstractAsyncContextManager = NullContext(sock)
    else:
        if not backend:
            backend = dns.asyncbackend.get_default_backend()
        stuple = _source_tuple(af, source, source_port)
        if backend.datagram_connection_required():
            dtuple = (where, port)
        else:
            dtuple = None
        cm = await backend.make_socket(af, socket.SOCK_DGRAM, 0, stuple, dtuple)
    async with cm as s:
        await send_udp(s, wire, destination, expiration)
        (r, received_time, _) = await receive_udp(
            s,
            destination,
            expiration,
            ignore_unexpected,
            one_rr_per_rrset,
            q.keyring,
            q.mac,
            ignore_trailing,
            raise_on_truncation,
            ignore_errors,
            q,
        )
        r.time = received_time - begin_time
        # We don't need to check q.is_response() if we are in ignore_errors mode
        # as receive_udp() will have checked it.
        if not (ignore_errors or q.is_response(r)):
            raise BadResponse
        return r


async def udp_with_fallback(
    q: dns.message.Message,
    where: str,
    timeout: Optional[float] = None,
    port: int = 53,
    source: Optional[str] = None,
    source_port: int = 0,
    ignore_unexpected: bool = False,
    one_rr_per_rrset: bool = False,
    ignore_trailing: bool = False,
    udp_sock: Optional[dns.asyncbackend.DatagramSocket] = None,
    tcp_sock: Optional[dns.asyncbackend.StreamSocket] = None,
    backend: Optional[dns.asyncbackend.Backend] = None,
    ignore_errors: bool = False,
) -> Tuple[dns.message.Message, bool]:
    """Return the response to the query, trying UDP first and falling back
    to TCP if UDP results in a truncated response.

    *udp_sock*, a ``dns.asyncbackend.DatagramSocket``, or ``None``,
    the socket to use for the UDP query.  If ``None``, the default, a
    socket is created.  Note that if a socket is provided the *source*,
    *source_port*, and *backend* are ignored for the UDP query.

    *tcp_sock*, a ``dns.asyncbackend.StreamSocket``, or ``None``, the
    socket to use for the TCP query.  If ``None``, the default, a
    socket is created.  Note that if a socket is provided *where*,
    *source*, *source_port*, and *backend*  are ignored for the TCP query.

    *backend*, a ``dns.asyncbackend.Backend``, or ``None``.  If ``None``,
    the default, then dnspython will use the default backend.

    See :py:func:`dns.query.udp_with_fallback()` for the documentation
    of the other parameters, exceptions, and return type of this
    method.
    """
    try:
        response = await udp(
            q,
            where,
            timeout,
            port,
            source,
            source_port,
            ignore_unexpected,
            one_rr_per_rrset,
            ignore_trailing,
            True,
            udp_sock,
            backend,
            ignore_errors,
        )
        return (response, False)
    except dns.message.Truncated:
        response = await tcp(
            q,
            where,
            timeout,
            port,
            source,
            source_port,
            one_rr_per_rrset,
            ignore_trailing,
            tcp_sock,
            backend,
        )
        return (response, True)


async def send_tcp(
    sock: dns.asyncbackend.StreamSocket,
    what: Union[dns.message.Message, bytes],
    expiration: Optional[float] = None,
) -> Tuple[int, float]:
    """Send a DNS message to the specified TCP socket.

    *sock*, a ``dns.asyncbackend.StreamSocket``.

    See :py:func:`dns.query.send_tcp()` for the documentation of the other
    parameters, exceptions, and return type of this method.
    """

    if isinstance(what, dns.message.Message):
        tcpmsg = what.to_wire(prepend_length=True)
    else:
        # copying the wire into tcpmsg is inefficient, but lets us
        # avoid writev() or doing a short write that would get pushed
        # onto the net
        tcpmsg = len(what).to_bytes(2, "big") + what
    sent_time = time.time()
    await sock.sendall(tcpmsg, _timeout(expiration, sent_time))
    return (len(tcpmsg), sent_time)


async def _read_exactly(sock, count, expiration):
    """Read the specified number of bytes from stream.  Keep trying until we
    either get the desired amount, or we hit EOF.
    """
    s = b""
    while count > 0:
        n = await sock.recv(count, _timeout(expiration))
        if n == b"":
            raise EOFError("EOF")
        count = count - len(n)
        s = s + n
    return s


async def receive_tcp(
    sock: dns.asyncbackend.StreamSocket,
    expiration: Optional[float] = None,
    one_rr_per_rrset: bool = False,
    keyring: Optional[Dict[dns.name.Name, dns.tsig.Key]] = None,
    request_mac: Optional[bytes] = b"",
    ignore_trailing: bool = False,
) -> Tuple[dns.message.Message, float]:
    """Read a DNS message from a TCP socket.

    *sock*, a ``dns.asyncbackend.StreamSocket``.

    See :py:func:`dns.query.receive_tcp()` for the documentation of the other
    parameters, exceptions, and return type of this method.
    """

    ldata = await _read_exactly(sock, 2, expiration)
    (l,) = struct.unpack("!H", ldata)
    wire = await _read_exactly(sock, l, expiration)
    received_time = time.time()
    r = dns.message.from_wire(
        wire,
        keyring=keyring,
        request_mac=request_mac,
        one_rr_per_rrset=one_rr_per_rrset,
        ignore_trailing=ignore_trailing,
    )
    return (r, received_time)


async def tcp(
    q: dns.message.Message,
    where: str,
    timeout: Optional[float] = None,
    port: int = 53,
    source: Optional[str] = None,
    source_port: int = 0,
    one_rr_per_rrset: bool = False,
    ignore_trailing: bool = False,
    sock: Optional[dns.asyncbackend.StreamSocket] = None,
    backend: Optional[dns.asyncbackend.Backend] = None,
) -> dns.message.Message:
    """Return the response obtained after sending a query via TCP.

    *sock*, a ``dns.asyncbacket.StreamSocket``, or ``None``, the
    socket to use for the query.  If ``None``, the default, a socket
    is created.  Note that if a socket is provided
    *where*, *port*, *source*, *source_port*, and *backend* are ignored.

    *backend*, a ``dns.asyncbackend.Backend``, or ``None``.  If ``None``,
    the default, then dnspython will use the default backend.

    See :py:func:`dns.query.tcp()` for the documentation of the other
    parameters, exceptions, and return type of this method.
    """

    wire = q.to_wire()
    (begin_time, expiration) = _compute_times(timeout)
    if sock:
        # Verify that the socket is connected, as if it's not connected,
        # it's not writable, and the polling in send_tcp() will time out or
        # hang forever.
        await sock.getpeername()
        cm: contextlib.AbstractAsyncContextManager = NullContext(sock)
    else:
        # These are simple (address, port) pairs, not family-dependent tuples
        # you pass to low-level socket code.
        af = dns.inet.af_for_address(where)
        stuple = _source_tuple(af, source, source_port)
        dtuple = (where, port)
        if not backend:
            backend = dns.asyncbackend.get_default_backend()
        cm = await backend.make_socket(
            af, socket.SOCK_STREAM, 0, stuple, dtuple, timeout
        )
    async with cm as s:
        await send_tcp(s, wire, expiration)
        (r, received_time) = await receive_tcp(
            s, expiration, one_rr_per_rrset, q.keyring, q.mac, ignore_trailing
        )
        r.time = received_time - begin_time
        if not q.is_response(r):
            raise BadResponse
        return r


async def tls(
    q: dns.message.Message,
    where: str,
    timeout: Optional[float] = None,
    port: int = 853,
    source: Optional[str] = None,
    source_port: int = 0,
    one_rr_per_rrset: bool = False,
    ignore_trailing: bool = False,
    sock: Optional[dns.asyncbackend.StreamSocket] = None,
    backend: Optional[dns.asyncbackend.Backend] = None,
    ssl_context: Optional[ssl.SSLContext] = None,
    server_hostname: Optional[str] = None,
    verify: Union[bool, str] = True,
) -> dns.message.Message:
    """Return the response obtained after sending a query via TLS.

    *sock*, an ``asyncbackend.StreamSocket``, or ``None``, the socket
    to use for the query.  If ``None``, the default, a socket is
    created.  Note that if a socket is provided, it must be a
    connected SSL stream socket, and *where*, *port*,
    *source*, *source_port*, *backend*, *ssl_context*, and *server_hostname*
    are ignored.

    *backend*, a ``dns.asyncbackend.Backend``, or ``None``.  If ``None``,
    the default, then dnspython will use the default backend.

    See :py:func:`dns.query.tls()` for the documentation of the other
    parameters, exceptions, and return type of this method.
    """
    (begin_time, expiration) = _compute_times(timeout)
    if sock:
        cm: contextlib.AbstractAsyncContextManager = NullContext(sock)
    else:
        if ssl_context is None:
            ssl_context = _make_dot_ssl_context(server_hostname, verify)
        af = dns.inet.af_for_address(where)
        stuple = _source_tuple(af, source, source_port)
        dtuple = (where, port)
        if not backend:
            backend = dns.asyncbackend.get_default_backend()
        cm = await backend.make_socket(
            af,
            socket.SOCK_STREAM,
            0,
            stuple,
            dtuple,
            timeout,
            ssl_context,
            server_hostname,
        )
    async with cm as s:
        timeout = _timeout(expiration)
        response = await tcp(
            q,
            where,
            timeout,
            port,
            source,
            source_port,
            one_rr_per_rrset,
            ignore_trailing,
            s,
            backend,
        )
        end_time = time.time()
        response.time = end_time - begin_time
        return response


def _maybe_get_resolver(
    resolver: Optional["dns.asyncresolver.Resolver"],
) -> "dns.asyncresolver.Resolver":
    # We need a separate method for this to avoid overriding the global
    # variable "dns" with the as-yet undefined local variable "dns"
    # in https().
    if resolver is None:
        # pylint: disable=import-outside-toplevel,redefined-outer-name
        import dns.asyncresolver

        resolver = dns.asyncresolver.Resolver()
    return resolver


async def https(
    q: dns.message.Message,
    where: str,
    timeout: Optional[float] = None,
    port: int = 443,
    source: Optional[str] = None,
    source_port: int = 0,  # pylint: disable=W0613
    one_rr_per_rrset: bool = False,
    ignore_trailing: bool = False,
    client: Optional["httpx.AsyncClient"] = None,
    path: str = "/dns-query",
    post: bool = True,
    verify: Union[bool, str] = True,
    bootstrap_address: Optional[str] = None,
    resolver: Optional["dns.asyncresolver.Resolver"] = None,
    family: int = socket.AF_UNSPEC,
    http_version: HTTPVersion = HTTPVersion.DEFAULT,
) -> dns.message.Message:
    """Return the response obtained after sending a query via DNS-over-HTTPS.

    *client*, a ``httpx.AsyncClient``.  If provided, the client to use for
    the query.

    Unlike the other dnspython async functions, a backend cannot be provided
    in this function because httpx always auto-detects the async backend.

    See :py:func:`dns.query.https()` for the documentation of the other
    parameters, exceptions, and return type of this method.
    """

    try:
        af = dns.inet.af_for_address(where)
    except ValueError:
        af = None
    if af is not None and dns.inet.is_address(where):
        if af == socket.AF_INET:
            url = f"https://{where}:{port}{path}"
        elif af == socket.AF_INET6:
            url = f"https://[{where}]:{port}{path}"
    else:
        url = where

    extensions = {}
    if bootstrap_address is None:
        # pylint: disable=possibly-used-before-assignment
        parsed = urllib.parse.urlparse(url)
        if parsed.hostname is None:
            raise ValueError("no hostname in URL")
        if dns.inet.is_address(parsed.hostname):
            bootstrap_address = parsed.hostname
            extensions["sni_hostname"] = parsed.hostname
        if parsed.port is not None:
            port = parsed.port

    if http_version == HTTPVersion.H3 or (
        http_version == HTTPVersion.DEFAULT and not have_doh
    ):
        if bootstrap_address is None:
            resolver = _maybe_get_resolver(resolver)
            assert parsed.hostname is not None  # for mypy
            answers = await resolver.resolve_name(parsed.hostname, family)
            bootstrap_address = random.choice(list(answers.addresses()))
        return await _http3(
            q,
            bootstrap_address,
            url,
            timeout,
            port,
            source,
            source_port,
            one_rr_per_rrset,
            ignore_trailing,
            verify=verify,
            post=post,
        )

    if not have_doh:
        raise NoDOH  # pragma: no cover
    # pylint: disable=possibly-used-before-assignment
    if client and not isinstance(client, httpx.AsyncClient):
        raise ValueError("session parameter must be an httpx.AsyncClient")
    # pylint: enable=possibly-used-before-assignment

    wire = q.to_wire()
    headers = {"accept": "application/dns-message"}

    h1 = http_version in (HTTPVersion.H1, HTTPVersion.DEFAULT)
    h2 = http_version in (HTTPVersion.H2, HTTPVersion.DEFAULT)

    backend = dns.asyncbackend.get_default_backend()

    if source is None:
        local_address = None
        local_port = 0
    else:
        local_address = source
        local_port = source_port

    if client:
        cm: contextlib.AbstractAsyncContextManager = NullContext(client)
    else:
        transport = backend.get_transport_class()(
            local_address=local_address,
            http1=h1,
            http2=h2,
            verify=verify,
            local_port=local_port,
            bootstrap_address=bootstrap_address,
            resolver=resolver,
            family=family,
        )

        cm = httpx.AsyncClient(http1=h1, http2=h2, verify=verify, transport=transport)

    async with cm as the_client:
        # see https://tools.ietf.org/html/rfc8484#section-4.1.1 for DoH
        # GET and POST examples
        if post:
            headers.update(
                {
                    "content-type": "application/dns-message",
                    "content-length": str(len(wire)),
                }
            )
            response = await backend.wait_for(
                the_client.post(
                    url,
                    headers=headers,
                    content=wire,
                    extensions=extensions,
                ),
                timeout,
            )
        else:
            wire = base64.urlsafe_b64encode(wire).rstrip(b"=")
            twire = wire.decode()  # httpx does a repr() if we give it bytes
            response = await backend.wait_for(
                the_client.get(
                    url,
                    headers=headers,
                    params={"dns": twire},
                    extensions=extensions,
                ),
                timeout,
            )

    # see https://tools.ietf.org/html/rfc8484#section-4.2.1 for info about DoH
    # status codes
    if response.status_code < 200 or response.status_code > 299:
        raise ValueError(
            f"{where} responded with status code {response.status_code}"
            f"\nResponse body: {response.content!r}"
        )
    r = dns.message.from_wire(
        response.content,
        keyring=q.keyring,
        request_mac=q.request_mac,
        one_rr_per_rrset=one_rr_per_rrset,
        ignore_trailing=ignore_trailing,
    )
    r.time = response.elapsed.total_seconds()
    if not q.is_response(r):
        raise BadResponse
    return r


async def _http3(
    q: dns.message.Message,
    where: str,
    url: str,
    timeout: Optional[float] = None,
    port: int = 853,
    source: Optional[str] = None,
    source_port: int = 0,
    one_rr_per_rrset: bool = False,
    ignore_trailing: bool = False,
    verify: Union[bool, str] = True,
    backend: Optional[dns.asyncbackend.Backend] = None,
    hostname: Optional[str] = None,
    post: bool = True,
) -> dns.message.Message:
    if not dns.quic.have_quic:
        raise NoDOH("DNS-over-HTTP3 is not available.")  # pragma: no cover

    url_parts = urllib.parse.urlparse(url)
    hostname = url_parts.hostname
    if url_parts.port is not None:
        port = url_parts.port

    q.id = 0
    wire = q.to_wire()
    (cfactory, mfactory) = dns.quic.factories_for_backend(backend)

    async with cfactory() as context:
        async with mfactory(
            context, verify_mode=verify, server_name=hostname, h3=True
        ) as the_manager:
            the_connection = the_manager.connect(where, port, source, source_port)
            (start, expiration) = _compute_times(timeout)
            stream = await the_connection.make_stream(timeout)
            async with stream:
                # note that send_h3() does not need await
                stream.send_h3(url, wire, post)
                wire = await stream.receive(_remaining(expiration))
                _check_status(stream.headers(), where, wire)
            finish = time.time()
        r = dns.message.from_wire(
            wire,
            keyring=q.keyring,
            request_mac=q.request_mac,
            one_rr_per_rrset=one_rr_per_rrset,
            ignore_trailing=ignore_trailing,
        )
    r.time = max(finish - start, 0.0)
    if not q.is_response(r):
        raise BadResponse
    return r


async def quic(
    q: dns.message.Message,
    where: str,
    timeout: Optional[float] = None,
    port: int = 853,
    source: Optional[str] = None,
    source_port: int = 0,
    one_rr_per_rrset: bool = False,
    ignore_trailing: bool = False,
    connection: Optional[dns.quic.AsyncQuicConnection] = None,
    verify: Union[bool, str] = True,
    backend: Optional[dns.asyncbackend.Backend] = None,
    hostname: Optional[str] = None,
    server_hostname: Optional[str] = None,
) -> dns.message.Message:
    """Return the response obtained after sending an asynchronous query via
    DNS-over-QUIC.

    *backend*, a ``dns.asyncbackend.Backend``, or ``None``.  If ``None``,
    the default, then dnspython will use the default backend.

    See :py:func:`dns.query.quic()` for the documentation of the other
    parameters, exceptions, and return type of this method.
    """

    if not dns.quic.have_quic:
        raise NoDOQ("DNS-over-QUIC is not available.")  # pragma: no cover

    if server_hostname is not None and hostname is None:
        hostname = server_hostname

    q.id = 0
    wire = q.to_wire()
    the_connection: dns.quic.AsyncQuicConnection
    if connection:
        cfactory = dns.quic.null_factory
        mfactory = dns.quic.null_factory
        the_connection = connection
    else:
        (cfactory, mfactory) = dns.quic.factories_for_backend(backend)

    async with cfactory() as context:
        async with mfactory(
            context,
            verify_mode=verify,
            server_name=server_hostname,
        ) as the_manager:
            if not connection:
                the_connection = the_manager.connect(where, port, source, source_port)
            (start, expiration) = _compute_times(timeout)
            stream = await the_connection.make_stream(timeout)
            async with stream:
                await stream.send(wire, True)
                wire = await stream.receive(_remaining(expiration))
            finish = time.time()
        r = dns.message.from_wire(
            wire,
            keyring=q.keyring,
            request_mac=q.request_mac,
            one_rr_per_rrset=one_rr_per_rrset,
            ignore_trailing=ignore_trailing,
        )
    r.time = max(finish - start, 0.0)
    if not q.is_response(r):
        raise BadResponse
    return r


async def _inbound_xfr(
    txn_manager: dns.transaction.TransactionManager,
    s: dns.asyncbackend.Socket,
    query: dns.message.Message,
    serial: Optional[int],
    timeout: Optional[float],
    expiration: float,
) -> Any:
    """Given a socket, does the zone transfer."""
    rdtype = query.question[0].rdtype
    is_ixfr = rdtype == dns.rdatatype.IXFR
    origin = txn_manager.from_wire_origin()
    wire = query.to_wire()
    is_udp = s.type == socket.SOCK_DGRAM
    if is_udp:
        udp_sock = cast(dns.asyncbackend.DatagramSocket, s)
        await udp_sock.sendto(wire, None, _timeout(expiration))
    else:
        tcp_sock = cast(dns.asyncbackend.StreamSocket, s)
        tcpmsg = struct.pack("!H", len(wire)) + wire
        await tcp_sock.sendall(tcpmsg, expiration)
    with dns.xfr.Inbound(txn_manager, rdtype, serial, is_udp) as inbound:
        done = False
        tsig_ctx = None
        while not done:
            (_, mexpiration) = _compute_times(timeout)
            if mexpiration is None or (
                expiration is not None and mexpiration > expiration
            ):
                mexpiration = expiration
            if is_udp:
                timeout = _timeout(mexpiration)
                (rwire, _) = await udp_sock.recvfrom(65535, timeout)
            else:
                ldata = await _read_exactly(tcp_sock, 2, mexpiration)
                (l,) = struct.unpack("!H", ldata)
                rwire = await _read_exactly(tcp_sock, l, mexpiration)
            r = dns.message.from_wire(
                rwire,
                keyring=query.keyring,
                request_mac=query.mac,
                xfr=True,
                origin=origin,
                tsig_ctx=tsig_ctx,
                multi=(not is_udp),
                one_rr_per_rrset=is_ixfr,
            )
            done = inbound.process_message(r)
            yield r
            tsig_ctx = r.tsig_ctx
        if query.keyring and not r.had_tsig:
            raise dns.exception.FormError("missing TSIG")


async def inbound_xfr(
    where: str,
    txn_manager: dns.transaction.TransactionManager,
    query: Optional[dns.message.Message] = None,
    port: int = 53,
    timeout: Optional[float] = None,
    lifetime: Optional[float] = None,
    source: Optional[str] = None,
    source_port: int = 0,
    udp_mode: UDPMode = UDPMode.NEVER,
    backend: Optional[dns.asyncbackend.Backend] = None,
) -> None:
    """Conduct an inbound transfer and apply it via a transaction from the
    txn_manager.

    *backend*, a ``dns.asyncbackend.Backend``, or ``None``.  If ``None``,
    the default, then dnspython will use the default backend.

    See :py:func:`dns.query.inbound_xfr()` for the documentation of
    the other parameters, exceptions, and return type of this method.
    """
    if query is None:
        (query, serial) = dns.xfr.make_query(txn_manager)
    else:
        serial = dns.xfr.extract_serial_from_query(query)
    af = dns.inet.af_for_address(where)
    stuple = _source_tuple(af, source, source_port)
    dtuple = (where, port)
    if not backend:
        backend = dns.asyncbackend.get_default_backend()
    (_, expiration) = _compute_times(lifetime)
    if query.question[0].rdtype == dns.rdatatype.IXFR and udp_mode != UDPMode.NEVER:
        s = await backend.make_socket(
            af, socket.SOCK_DGRAM, 0, stuple, dtuple, _timeout(expiration)
        )
        async with s:
            try:
                async for _ in _inbound_xfr(
                    txn_manager, s, query, serial, timeout, expiration
                ):
                    pass
                return
            except dns.xfr.UseTCP:
                if udp_mode == UDPMode.ONLY:
                    raise

    s = await backend.make_socket(
        af, socket.SOCK_STREAM, 0, stuple, dtuple, _timeout(expiration)
    )
    async with s:
        async for _ in _inbound_xfr(txn_manager, s, query, serial, timeout, expiration):
            pass
