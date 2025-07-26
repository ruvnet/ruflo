# Copyright (C) Dnspython Contributors, see LICENSE for text of ISC license

import base64
import copy
import functools
import socket
import struct
import time
import urllib
from typing import Any, Optional

import aioquic.h3.connection  # type: ignore
import aioquic.h3.events  # type: ignore
import aioquic.quic.configuration  # type: ignore
import aioquic.quic.connection  # type: ignore

import dns.inet

QUIC_MAX_DATAGRAM = 2048
MAX_SESSION_TICKETS = 8
# If we hit the max sessions limit we will delete this many of the oldest connections.
# The value must be a integer > 0 and <= MAX_SESSION_TICKETS.
SESSIONS_TO_DELETE = MAX_SESSION_TICKETS // 4


class UnexpectedEOF(Exception):
    pass


class Buffer:
    def __init__(self):
        self._buffer = b""
        self._seen_end = False

    def put(self, data, is_end):
        if self._seen_end:
            return
        self._buffer += data
        if is_end:
            self._seen_end = True

    def have(self, amount):
        if len(self._buffer) >= amount:
            return True
        if self._seen_end:
            raise UnexpectedEOF
        return False

    def seen_end(self):
        return self._seen_end

    def get(self, amount):
        assert self.have(amount)
        data = self._buffer[:amount]
        self._buffer = self._buffer[amount:]
        return data

    def get_all(self):
        assert self.seen_end()
        data = self._buffer
        self._buffer = b""
        return data


class BaseQuicStream:
    def __init__(self, connection, stream_id):
        self._connection = connection
        self._stream_id = stream_id
        self._buffer = Buffer()
        self._expecting = 0
        self._headers = None
        self._trailers = None

    def id(self):
        return self._stream_id

    def headers(self):
        return self._headers

    def trailers(self):
        return self._trailers

    def _expiration_from_timeout(self, timeout):
        if timeout is not None:
            expiration = time.time() + timeout
        else:
            expiration = None
        return expiration

    def _timeout_from_expiration(self, expiration):
        if expiration is not None:
            timeout = max(expiration - time.time(), 0.0)
        else:
            timeout = None
        return timeout

    # Subclass must implement receive() as sync / async and which returns a message
    # or raises.

    # Subclass must implement send() as sync / async and which takes a message and
    # an EOF indicator.

    def send_h3(self, url, datagram, post=True):
        if not self._connection.is_h3():
            raise SyntaxError("cannot send H3 to a non-H3 connection")
        url_parts = urllib.parse.urlparse(url)
        path = url_parts.path.encode()
        if post:
            method = b"POST"
        else:
            method = b"GET"
            path += b"?dns=" + base64.urlsafe_b64encode(datagram).rstrip(b"=")
        headers = [
            (b":method", method),
            (b":scheme", url_parts.scheme.encode()),
            (b":authority", url_parts.netloc.encode()),
            (b":path", path),
            (b"accept", b"application/dns-message"),
        ]
        if post:
            headers.extend(
                [
                    (b"content-type", b"application/dns-message"),
                    (b"content-length", str(len(datagram)).encode()),
                ]
            )
        self._connection.send_headers(self._stream_id, headers, not post)
        if post:
            self._connection.send_data(self._stream_id, datagram, True)

    def _encapsulate(self, datagram):
        if self._connection.is_h3():
            return datagram
        l = len(datagram)
        return struct.pack("!H", l) + datagram

    def _common_add_input(self, data, is_end):
        self._buffer.put(data, is_end)
        try:
            return (
                self._expecting > 0 and self._buffer.have(self._expecting)
            ) or self._buffer.seen_end
        except UnexpectedEOF:
            return True

    def _close(self):
        self._connection.close_stream(self._stream_id)
        self._buffer.put(b"", True)  # send EOF in case we haven't seen it.


class BaseQuicConnection:
    def __init__(
        self,
        connection,
        address,
        port,
        source=None,
        source_port=0,
        manager=None,
    ):
        self._done = False
        self._connection = connection
        self._address = address
        self._port = port
        self._closed = False
        self._manager = manager
        self._streams = {}
        if manager.is_h3():
            self._h3_conn = aioquic.h3.connection.H3Connection(connection, False)
        else:
            self._h3_conn = None
        self._af = dns.inet.af_for_address(address)
        self._peer = dns.inet.low_level_address_tuple((address, port))
        if source is None and source_port != 0:
            if self._af == socket.AF_INET:
                source = "0.0.0.0"
            elif self._af == socket.AF_INET6:
                source = "::"
            else:
                raise NotImplementedError
        if source:
            self._source = (source, source_port)
        else:
            self._source = None

    def is_h3(self):
        return self._h3_conn is not None

    def close_stream(self, stream_id):
        del self._streams[stream_id]

    def send_headers(self, stream_id, headers, is_end=False):
        self._h3_conn.send_headers(stream_id, headers, is_end)

    def send_data(self, stream_id, data, is_end=False):
        self._h3_conn.send_data(stream_id, data, is_end)

    def _get_timer_values(self, closed_is_special=True):
        now = time.time()
        expiration = self._connection.get_timer()
        if expiration is None:
            expiration = now + 3600  # arbitrary "big" value
        interval = max(expiration - now, 0)
        if self._closed and closed_is_special:
            # lower sleep interval to avoid a race in the closing process
            # which can lead to higher latency closing due to sleeping when
            # we have events.
            interval = min(interval, 0.05)
        return (expiration, interval)

    def _handle_timer(self, expiration):
        now = time.time()
        if expiration <= now:
            self._connection.handle_timer(now)


class AsyncQuicConnection(BaseQuicConnection):
    async def make_stream(self, timeout: Optional[float] = None) -> Any:
        pass


class BaseQuicManager:
    def __init__(
        self, conf, verify_mode, connection_factory, server_name=None, h3=False
    ):
        self._connections = {}
        self._connection_factory = connection_factory
        self._session_tickets = {}
        self._tokens = {}
        self._h3 = h3
        if conf is None:
            verify_path = None
            if isinstance(verify_mode, str):
                verify_path = verify_mode
                verify_mode = True
            if h3:
                alpn_protocols = ["h3"]
            else:
                alpn_protocols = ["doq", "doq-i03"]
            conf = aioquic.quic.configuration.QuicConfiguration(
                alpn_protocols=alpn_protocols,
                verify_mode=verify_mode,
                server_name=server_name,
            )
            if verify_path is not None:
                conf.load_verify_locations(verify_path)
        self._conf = conf

    def _connect(
        self,
        address,
        port=853,
        source=None,
        source_port=0,
        want_session_ticket=True,
        want_token=True,
    ):
        connection = self._connections.get((address, port))
        if connection is not None:
            return (connection, False)
        conf = self._conf
        if want_session_ticket:
            try:
                session_ticket = self._session_tickets.pop((address, port))
                # We found a session ticket, so make a configuration that uses it.
                conf = copy.copy(conf)
                conf.session_ticket = session_ticket
            except KeyError:
                # No session ticket.
                pass
            # Whether or not we found a session ticket, we want a handler to save
            # one.
            session_ticket_handler = functools.partial(
                self.save_session_ticket, address, port
            )
        else:
            session_ticket_handler = None
        if want_token:
            try:
                token = self._tokens.pop((address, port))
                # We found a token, so make a configuration that uses it.
                conf = copy.copy(conf)
                conf.token = token
            except KeyError:
                # No token
                pass
            # Whether or not we found a token, we want a handler to save # one.
            token_handler = functools.partial(self.save_token, address, port)
        else:
            token_handler = None

        qconn = aioquic.quic.connection.QuicConnection(
            configuration=conf,
            session_ticket_handler=session_ticket_handler,
            token_handler=token_handler,
        )
        lladdress = dns.inet.low_level_address_tuple((address, port))
        qconn.connect(lladdress, time.time())
        connection = self._connection_factory(
            qconn, address, port, source, source_port, self
        )
        self._connections[(address, port)] = connection
        return (connection, True)

    def closed(self, address, port):
        try:
            del self._connections[(address, port)]
        except KeyError:
            pass

    def is_h3(self):
        return self._h3

    def save_session_ticket(self, address, port, ticket):
        # We rely on dictionaries keys() being in insertion order here.  We
        # can't just popitem() as that would be LIFO which is the opposite of
        # what we want.
        l = len(self._session_tickets)
        if l >= MAX_SESSION_TICKETS:
            keys_to_delete = list(self._session_tickets.keys())[0:SESSIONS_TO_DELETE]
            for key in keys_to_delete:
                del self._session_tickets[key]
        self._session_tickets[(address, port)] = ticket

    def save_token(self, address, port, token):
        # We rely on dictionaries keys() being in insertion order here.  We
        # can't just popitem() as that would be LIFO which is the opposite of
        # what we want.
        l = len(self._tokens)
        if l >= MAX_SESSION_TICKETS:
            keys_to_delete = list(self._tokens.keys())[0:SESSIONS_TO_DELETE]
            for key in keys_to_delete:
                del self._tokens[key]
        self._tokens[(address, port)] = token


class AsyncQuicManager(BaseQuicManager):
    def connect(self, address, port=853, source=None, source_port=0):
        raise NotImplementedError
